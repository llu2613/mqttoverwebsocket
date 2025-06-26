const protobuf = require("protobufjs");
const path = require("path");

let cachedRoot = null;

async function loadProto() {
    if (!cachedRoot) {
        cachedRoot = await protobuf.load(path.resolve(__dirname, "mqtt_config.proto"));
    }
    return cachedRoot;
}

module.exports = { loadProto };