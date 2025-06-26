const protobuf = require("protobufjs");
const fs = require("fs");
const { loadProto } = require("./mqtt_config_proto_loader");

async function encode(jsonData) {
    // Load the .proto file
    const root = await loadProto(); // 使用缓存的 Proto 定义
    const DeviceConfig = root.lookupType("DeviceConfig");
    // const root = await protobuf.load("mqtt_config.proto");
    // const DeviceConfig = root.lookupType("DeviceConfig");

    // Validate and encode
    const errMsg = DeviceConfig.verify(jsonData);
    if (errMsg) throw new Error(errMsg);

    const message = DeviceConfig.create(jsonData);
    const buffer = DeviceConfig.encode(message).finish();

    return buffer;
}

async function decode(buffer) {
    // Load the .proto file
    const root = await loadProto(); // 使用缓存的 Proto 定义
    const DeviceConfig = root.lookupType("DeviceConfig");
    // const root = await protobuf.load("mqtt_config.proto");
    // const DeviceConfig = root.lookupType("DeviceConfig");

    return DeviceConfig.decode(buffer);
}

module.exports = {
    encode, decode
};
