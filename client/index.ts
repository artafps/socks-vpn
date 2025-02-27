import { WebSocket } from "ws";
import { WSConnection } from "./utils/Connection";
import { Server } from "./Server/index";
import { LocalSocksServer } from "./Socket";
import net from "net";
import { UdpSocketServer } from "./Socket/udpServer";
const SERVER = process.argv[2] ?? "ws://localhost:9092";

const COMMANDS = {
  AUTH: 128,
  NEW_TASK: 129,
  CONNECT: 1,
  DATA: 2,
};

const ERRORS = {
  BAD_UNAME_PW: 1,
  TID_EXISTS: 2,
  NO_CONNECTION_ON_TASK: 3,
  TID_NOT_FOUND: 4,
};

async function main() {
  while (true) {
    const ws = new WebSocket(SERVER);
    await new Promise<void>((resolve, reject) => {
      let is_resolved = false;
      setTimeout(() => {
        if (!is_resolved) {
          reject("time out");
        }
      }, 10000);
      ws.once("open", () => {
        if (is_resolved) return;
        is_resolved = true;
        console.log("the connection has been established");
        resolve();
      });
      ws.once("error", (err: any) => {
        if (is_resolved) return;
        is_resolved = true;
        console.log("WS connection error", err);
        reject();
      });
    });
    const wsConnection = new WSConnection(ws);
    const server = new Server(wsConnection);
    console.log('server has been created')
    server.start();
    console.log('server has been started')
    server.authenticate("admin", "adminpw");
    console.log('successful auth')
    const socketServer = net.createServer();
    socketServer.listen(9091);
    console.log('tcp server created')
    const udpServer = new UdpSocketServer(9091);
    console.log('udp instance created');
    const socks_server = new LocalSocksServer(socketServer, server, udpServer);
    await waitTillDisconnection(wsConnection);
    try {
      socks_server.destroy();
      wsConnection.close();
    } catch (err) { }
  }
}

async function waitTillDisconnection(ws: WSConnection): Promise<void> {
  return new Promise<void>((resolve) => {
    ws.on("close", () => {
      resolve();
    });
  });
}

main();
