const express = require('express')
const path = require('path');
const morgan = require('morgan')
const cors = require('cors')
const helmet = require('helmet')
const app = express()
const WebSocket = require('ws');
const mqtt = require('mqtt');
const port = 3000

// 设置静态文件目录
app.use(express.static(path.join(__dirname, 'public')));

// 中间件
app.use(express.json()) // 用于解析 JSON 请求体
app.use(express.urlencoded({ extended: true })) // 用于解析 URL 编码的请求体
// 添加中间件
app.use(morgan('dev')) // 日志记录
app.use(cors()) // 跨域支持
app.use(helmet()) // 安全头部

// 存储活跃的MQTT客户端和WebSocket连接
const activeConnections = new Map();

// 路由
app.get('/', (req, res) => {
    res.send('Hello World!')
})

// HTTP端点 - 动态配置MQTT
app.post('/api/mqtt/connect', (req, res) => {
    const { connectionId, mqttConfig } = req.body;

    if (!connectionId || !mqttConfig || !mqttConfig.host) {
        return res.status(400).json({ error: 'Missing required parameters' });
    }

    const connection = activeConnections.get(connectionId);
    if (!connection) {
        return res.status(404).json({ error: 'WebSocket connection not found' });
    }

    // 如果已有MQTT连接，先关闭
    if (connection.mqttClient) {
        connection.mqttClient.end();
    }

    // 创建新的MQTT客户端
    const mqttClient = mqtt.connect(mqttConfig.host, {
        port: mqttConfig.port || 1883,
        username: mqttConfig.username,
        password: mqttConfig.password,
        clientId: mqttConfig.clientId || `mqtt_${Date.now()}`,
        reconnectPeriod: 5000 // 5秒重连间隔
    });

    // MQTT事件处理
    mqttClient.on('connect', () => {
        console.log(`MQTT connected for ${connectionId}`);
        connection.mqttClient = mqttClient;
        connection.ws.send(JSON.stringify({
            type: 'mqtt-status',
            status: 'connected'
        }));
    });

    mqttClient.on('error', (err) => {
        console.error(`MQTT error for ${connectionId}:`, err);
        connection.ws.send(JSON.stringify({
            type: 'mqtt-error',
            error: err.message
        }));
    });

    mqttClient.on('message', (topic, message) => {
        // 转发MQTT消息到WebSocket
        connection.ws.send(JSON.stringify({
            type: 'mqtt-message',
            topic,
            message: message.toString()
        }));
    });

    mqttClient.on('close', () => {
        console.log(`MQTT disconnected for ${connectionId}`);
        connection.ws.send(JSON.stringify({
            type: 'mqtt-status',
            status: 'disconnected'
        }));
    });

    res.json({ success: true, connectionId });
});

// 启动服务器
const server = app.listen(port, () => {
    console.log(`Example app listening at http://localhost:${port}`)
})

// 创建WebSocket服务器
const wss = new WebSocket.Server({ server });

// WebSocket连接处理
wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const connid = url.searchParams.get('connid');
    const seckey = url.searchParams.get('seckey');
    const connectionId = connid || req.headers['sec-websocket-key'] || Date.now().toString();
    console.log(`WebSocket connected: ${connectionId}, ${seckey}`);

    // 存储WebSocket连接
    activeConnections.set(connectionId, { ws, mqttClient: null });

    // 接收WebSocket消息
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            handleWebSocketMessage(connectionId, data);
        } catch (err) {
            console.error('WebSocket message error:', err);
        }
    });

    // 连接关闭
    ws.on('close', () => {
        cleanupConnection(connectionId);
        console.log(`WebSocket disconnected: ${connectionId}`);
    });

    // 错误处理
    ws.on('error', (err) => {
        console.error('WebSocket error:', err);
        cleanupConnection(connectionId);
    });
});

// 处理WebSocket消息
function handleWebSocketMessage(connectionId, data) {
    const connection = activeConnections.get(connectionId);
    if (!connection || !connection.mqttClient) return;

    switch (data.action) {
        case 'subscribe':
            connection.mqttClient.subscribe(data.topic, (err) => {
                if (err) {
                    connection.ws.send(JSON.stringify({
                        type: 'mqtt-error',
                        error: `Subscribe failed: ${err.message}`
                    }));
                } else {
                    connection.ws.send(JSON.stringify({
                        type: 'mqtt-subscribed',
                        topic: data.topic
                    }));
                }
            });
            break;

        case 'unsubscribe':
            connection.mqttClient.unsubscribe(data.topic);
            break;

        case 'publish':
            connection.mqttClient.publish(data.topic, data.message, (err) => {
                if (err) {
                    connection.ws.send(JSON.stringify({
                        type: 'mqtt-error',
                        error: `Publish failed: ${err.message}`
                    }));
                }
            });
            break;

        default:
            console.warn(`Unknown action: ${data.action}`);
    }
}

// 清理连接
function cleanupConnection(connectionId) {
    const connection = activeConnections.get(connectionId);
    if (connection) {
        if (connection.mqttClient) {
            connection.mqttClient.end();
        }
        activeConnections.delete(connectionId);
    }
}

// 优雅关闭
process.on('SIGINT', () => {
    console.log('Shutting down...');

    // 关闭所有MQTT连接
    activeConnections.forEach((connection) => {
        if (connection.mqttClient) {
            connection.mqttClient.end();
        }
        if (connection.ws) {
            connection.ws.close();
        }
    });

    // 关闭WebSocket服务器
    wss.close(() => {
        server.close(() => {
            process.exit(0);
        });
    });
});
