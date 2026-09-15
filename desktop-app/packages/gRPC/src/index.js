/**
 * gRPC 客户端工厂
 */
class GrpcClientFactory {
  static createClient(protoFile, endpoint) {
    // TODO: 接入 @grpc/grpc-js
    console.log('[gRPC] would connect to', endpoint, 'using', protoFile);
    return null;
  }
}
module.exports = { GrpcClientFactory };
