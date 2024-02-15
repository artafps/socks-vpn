import net from "net";
import { Server } from "../Server";
import TaskManager from "../utils/TaskManager";
import { Task } from "../utils/interfaces";

const METHODS: { [key in number]: string } = {
  1: "connect",
  2: "bind",
  3: "udp",
};

export class LocalSocksServer {
  constructor(
    private localServer: net.Server,
    private remoteServer: Server,
  ) {
    localServer.on("connection", (socket) => this.onConnection(socket));
    localServer.on("error", () => this.onError());
    localServer.on("close", () => this.onClose());
  }
  private onClose() {}
  private onError() {}
  private onConnection(socket: net.Socket) {
    new SocksClientConenction(socket, this.remoteServer);
  }
}

class SocksClientConenction {
  public state: "auth" | "ready" | "connect" = "auth";
  public task: Task | undefined = undefined;
  constructor(
    private socket: net.Socket,
    private remoteServer: Server,
  ) {
    this.socket.on("data", (data) => this.onData(data));
    this.socket.on("error", () => this.onError());
    this.socket.on("close", () => this.onClose());
  }

  private async onData(data: Buffer) {
    console.log("client on data", data);
    if (this.state == "auth") {
      if (data.at(0) != 5) {
        return this.close("version was not five");
      }
      if (data.readUInt8(1) < 1) {
        return this.close("no method was provided by the client");
      }
      this.socket.write(Buffer.from([0x05, 0x00]));
      this.state = "ready";
    }
    if (this.state == "ready") {
      if (data.at(0) != 5) {
        return this.close("version was not five");
      }
      if (data.at(1) != 1) {
        return this.close(
          "method was not connect: " +
            data.at(1) +
            " meaning: " +
            METHODS[data.at(1) as number],
        );
      }
      console.log("we have a connection request!");
      this.task = await this.remoteServer.initiateTask();
      console.log("we have a task for it!", this.task.tid);
    }
  }
  private onError() {
    console.log("socket on error ???");
  }
  private onClose() {
    console.log("socket closed???");
  }
  private close(msg?: string) {
    if (msg) console.log(msg);
  }
}

async function connection_listener(s: net.Socket) {
  let state: 0 | 1 | 2 | 3 = 0;
  let connection_to_server: net.Socket | undefined;
  s.on("close", () => {
    if (connection_to_server && !connection_to_server.closed)
      connection_to_server.end();
  });
  s.on("error", () => {
    console.log("error happened in client side");
    if (connection_to_server && !connection_to_server.closed)
      connection_to_server.end();
    if (!s.closed) s.end();
  });
  s.on("data", async (data: Buffer) => {
    try {
      // console.log("whole data is:", data);
      if (state == 0) {
        if (data.at(0) != 5) {
          throw new Error("version must be five");
        }
        const method_count = data.readUInt8(1);
        const methods = data.subarray(2, 2 + method_count);
        state++;
        data.readUIntBE(0, 2);
        s.write(Buffer.from([0x05, 0x00]));
      } else if (state == 1) {
        if (data.at(0) != 5) {
          throw new Error("version must be five");
        }
        if (data.at(1) == 1) {
          if (data.at(3) == 1 || true) {
            // ip address
            const addr = parse_addr(data, 3);
            console.dir(addr);
            connection_to_server = net.createConnection({
              host: addr.host,
              port: addr.port,
            });
            await wait_for_connection(connection_to_server);
            const ip_buffer = ip_to_buffer(
              connection_to_server.localAddress as string,
              connection_to_server.localPort as number,
            );
            const prefix = Buffer.from([0x05, 0x00, 0x00, 0x01]);
            const response = Buffer.concat([prefix, ip_buffer]);
            s.write(response);
            connection_to_server.on("data", (d) => {
              s.write(d);
            });
            connection_to_server.on("close", () => {
              if (!s.closed) s.end();
            });
            connection_to_server.on("error", () => {
              console.log("Error happens in connection to server");
              if (connection_to_server && !connection_to_server.closed)
                connection_to_server.end();
              if (!s.closed) s.end();
            });
            state++;
          }
        } else {
          throw new Error("method was not connect");
        }
      } else if (state == 2) {
        if (!connection_to_server) {
          throw new Error("No connection established");
        }
        connection_to_server.write(data);
      } else if (state == 3) {
      }
    } catch (err) {
      console.log("err occurred", err);
      console.log("closing the connection");
      if (!s.closed) s.end();
    }
  });
}

const wait_for_connection = (connection: net.Socket): Promise<void> =>
  new Promise((resolve, reject) => {
    connection.on("connect", () => {
      resolve();
    });
    connection.on("error", (err) => reject(err));
  });

const parse_addr = (
  buffer: Buffer,
  offset: number = 0,
): { host: string; port: number } => {
  if (buffer.at(offset) == 1) {
    offset += 1;
    const ipv4: string[] = [];
    const address = buffer.subarray(offset, offset + 4);
    for (const byte of address) {
      ipv4.push(byte.toString());
    }
    const port = buffer.readUintBE(offset + 4, 2);

    return { host: ipv4.join("."), port };
  } else if (buffer.at(offset) == 3) {
    offset += 1;
    const domain_len = buffer.at(offset);
    offset += 1;
    if (!domain_len) throw new Error("No length found for domain");
    const address = buffer.subarray(offset, offset + domain_len);
    const port = buffer.readUintBE(offset + domain_len, 2);
    const domain = address.toString();
    return { host: domain, port };
  } else {
    offset += 1;
    let ipv6str = "";
    for (let b = 0; b < 16; ++b) {
      if (b % 2 === 0 && b > 0) ipv6str += ":";
      ipv6str +=
        ((buffer.at(offset + b) as number) < 16 ? "0" : "") +
        (buffer.at(offset + b) as number).toString(16);
    }
    const port = buffer.readUintBE(offset + 16, 2);
    console.log(offset + 16);
    return { host: ipv6str, port };
  }
};

const ip_to_buffer = (ipv4: string, port: number): Buffer => {
  const ip_buffer = Buffer.from(ipv4.split(".").map((chunk) => +chunk));
  const port_buffer = Buffer.allocUnsafe(2);
  port_buffer.writeUIntBE(port, 0, 2);
  return Buffer.concat([ip_buffer, port_buffer]);
};
