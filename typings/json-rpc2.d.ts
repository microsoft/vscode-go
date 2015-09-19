declare module "json-rpc2" {
	export interface RPCConnection {
		call<T>(command: string, args: any[], callback: (err: Error, result:T) => void): void;
	}
	
	export class Client {
		static $create(port: number, addr: string): Client;
		connectSocket(callback: (err: Error, conn: RPCConnection) => void): void;
	}
}