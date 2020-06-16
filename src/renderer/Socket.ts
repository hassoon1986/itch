import { ButlerHandled, Packet, PacketCreator, packets } from "common/packets";
import { QueryCreator, QueryRequest, queries } from "common/queries";
import { uuid } from "common/util/uuid";
import { useEffect } from "react";
import {
  NotificationCreator,
  RequestCreator,
  RequestError,
  RpcResult,
  Request,
  Notification,
} from "@itchio/valet/support";
import { ModalCreator } from "common/modals";
import { Code } from "@itchio/valet/messages";

type Listener<Payload> = (payload: Payload) => void;
export type Cancel = () => void;

interface Outbound<Result> {
  resolve: (result: Result) => void;
  reject: (error: Error) => void;
}

export function useListen<T>(
  socket: Socket,
  pc: PacketCreator<T>,
  cb: (payload: T) => void,
  deps: React.DependencyList
) {
  useEffect(
    () => {
      return socket.listen(pc, cb);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    deps
  );
}

const TYPES_THAT_ARE_FORBIDDEN_TO_LISTEN = (() => {
  let map: { [key: string]: true } = {};
  for (const pc of [
    packets.butlerRequest,
    packets.butlerResult,
    packets.butlerNotification,
    packets.queryRequest,
    packets.queryResult,
  ]) {
    map[pc.__type] = true;
  }
  return map;
})();

type RequestHandler<Params, Result> = (params: Params) => Promise<Result>;
type NotificationHandler<Params> = (params: Params) => void;

/**
 * Handles conversations with butler, over IPC
 */
export class Conversation {
  private cancelled = false;
  private idSeed = 1;
  private outboundCalls: { [key: number]: Outbound<any> } = {};

  requestHandlers?: {
    [method: string]: RequestHandler<any, any> | undefined;
  };
  notificationHandlers?: {
    [method: string]: NotificationHandler<any> | undefined;
  };

  constructor(private socket: Socket, private id: string) {}

  onRequest<Params, Result>(
    rc: RequestCreator<Params, Result>,
    f: RequestHandler<Params, Result>
  ) {
    if (!this.requestHandlers) {
      this.requestHandlers = {};
    }
    this.requestHandlers[rc.__method] = f;
  }

  onNotification<Params>(
    nc: NotificationCreator<Params>,
    f: NotificationHandler<Params>
  ) {
    if (!this.notificationHandlers) {
      this.notificationHandlers = {};
    }
    this.notificationHandlers[nc.__method] = f;
  }

  handled(): ButlerHandled | undefined {
    let requests = this.requestHandlers
      ? Object.keys(this.requestHandlers)
      : undefined;
    let notifications = this.notificationHandlers
      ? Object.keys(this.notificationHandlers)
      : undefined;
    if (requests || notifications) {
      return { requests, notifications };
    } else {
      return undefined;
    }
  }

  generateID(): number {
    let res = this.idSeed;
    this.idSeed++;
    return res;
  }

  async call<Params, Result>(
    rc: RequestCreator<Params, Result>,
    params: Params
  ): Promise<Result> {
    return await this.internalCall(rc, params);
  }

  private async internalCall<Params, Result>(
    rc: RequestCreator<Params, Result>,
    params: Params,
    handled?: ButlerHandled
  ): Promise<Result> {
    let request = rc(params)(this);
    this.socket.send(packets.butlerRequest, {
      conv: this.id,
      handled: this.handled(),
      req: request,
    });

    return new Promise((resolve, reject) => {
      this.outboundCalls[request.id] = { resolve, reject };
    });
  }

  private getRequestHandler(
    method: string
  ): RequestHandler<any, any> | undefined {
    if (!this.requestHandlers) {
      return undefined;
    }
    return this.requestHandlers[method];
  }

  private getNotificationHandler(
    method: string
  ): NotificationHandler<any> | undefined {
    if (!this.notificationHandlers) {
      return undefined;
    }
    return this.notificationHandlers[method];
  }

  processNotification(notif: Notification<any>) {
    let handler = this.getNotificationHandler(notif.method);
    if (handler) {
      handler(notif.method);
    }
  }

  processRequest(request: Request<any, any>) {
    console.log(`Processing request `, request);

    let handler = this.getRequestHandler(request.method);
    if (!handler) {
      console.warn(`Unhandled server-side request: `, request);
      return;
    }
    (async () => {
      try {
        console.log(`Running handler...`);
        const result = await handler(request.params);
        console.log(`Got result: `, result);
        this.socket.send(packets.butlerResult, {
          conv: this.id,
          res: {
            jsonrpc: "2.0",
            id: request.id,
            result,
          },
        });
      } catch (e) {
        console.log(`Got error: `, e);
        this.socket.send(packets.butlerResult, {
          conv: this.id,
          res: {
            jsonrpc: "2.0",
            id: request.id,
            error: {
              code: -32603,
              message: e.message,
              data: {
                stack: e.stack,
              },
            },
          },
        });
      }
    })();
  }

  processResult(result: RpcResult<any>) {
    if (typeof result.id !== "number") {
      return;
    }

    let outbound = this.outboundCalls[result.id];
    if (!outbound) {
      return;
    }

    delete this.outboundCalls[result.id];
    if (result.error) {
      outbound.reject(new RequestError(result.error));
    } else {
      outbound.resolve(result.result);
    }
  }

  cancel() {
    if (this.cancelled) {
      return;
    }
    this.cancelled = true;

    for (const id of Object.keys(this.outboundCalls)) {
      const outbound = this.outboundCalls[Number(id)];
      outbound.reject(
        new RequestError({
          code: Code.OperationCancelled,
          message: "Cancelled",
        })
      );
    }
    this.socket.send(packets.butlerCancel, { conv: this.id });
    this.outboundCalls = {};
  }
}

export class Socket {
  private listeners: {
    [type: string]: Listener<any>[];
  } = {};
  private idSeed = 1;
  private conversations: {
    [id: string]: Conversation;
  } = {};
  private outboundQueries: { [key: number]: Outbound<any> } = {};

  constructor() {
    this.initSocket();
  }

  private initSocket() {
    window.addEventListener("from-main", (ev) => {
      let cev = (ev as any) as CustomEvent<string>;
      this.process(cev.detail);
    });
  }

  private process(msg: string) {
    let packet = JSON.parse(msg) as Packet<any>;

    if (packet.type === packets.butlerResult.__type) {
      let payload = packet.payload as typeof packets.butlerResult.__payload;
      let conv = this.conversations[payload.conv];
      if (!conv) {
        // just drop it
        return;
      }
      conv.processResult(payload.res);
    } else if (packet.type === packets.butlerNotification.__type) {
      let payload = packet.payload as typeof packets.butlerNotification.__payload;
      let conv = this.conversations[payload.conv];
      if (!conv) {
        // just drop it
        return;
      }
      conv.processNotification(payload.notif);
    } else if (packet.type === packets.butlerRequest.__type) {
      let payload = packet.payload as typeof packets.butlerRequest.__payload;
      let conv = this.conversations[payload.conv];
      if (!conv) {
        // just drop it
        return;
      }
      conv.processRequest(payload.req);
    } else if (packet.type === packets.queryResult.__type) {
      let response = packet.payload as typeof packets.queryResult.__payload;
      let outbound = this.outboundQueries[response.id];
      delete this.outboundQueries[response.id];
      if (outbound) {
        if (response.state === "error") {
          outbound.reject(
            new Error(
              `butler-side error: ${
                response.error.stack ?? response.error.message
              }`
            )
          );
        } else {
          outbound.resolve(response.result);
        }
      }
    }

    let listeners = this.listeners[packet.type];
    if (listeners) {
      for (const l of listeners) {
        l(packet.payload);
      }
    }
  }

  send<T>(pc: PacketCreator<T>, payload: T): void {
    if (payload === null) {
      throw new Error(`null payload for ${pc.__type} - that's illegal`);
    }
    let msg = pc(payload);
    let extendedWindow = window as typeof window & {
      sendToMain: (payload: string) => void;
    };
    extendedWindow.sendToMain(JSON.stringify(msg));
  }

  listen<T>(packet: PacketCreator<T>, listener: Listener<T>): Cancel {
    let type = packet.__type;
    if (TYPES_THAT_ARE_FORBIDDEN_TO_LISTEN[type]) {
      throw new Error(
        `Can't listen for events of type ${type} - those are used internally`
      );
    }

    if (!this.listeners[type]) {
      this.listeners[type] = [];
    }
    this.listeners[type].push(listener);
    let cancel = () => {
      this.listeners[type] = this.listeners[type].filter((x) => x !== listener);
    };
    return cancel;
  }

  generateID(): number {
    let res = this.idSeed;
    this.idSeed++;
    return res;
  }

  async call<Params, Result>(
    rc: RequestCreator<Params, Result>,
    params: Params,
    setup?: SetupFunc
  ): Promise<Result> {
    let convID = uuid();
    let conv = new Conversation(this, convID);
    if (setup) {
      setup(conv);
    }
    this.conversations[convID] = conv;
    try {
      return await conv.call(rc, params);
    } finally {
      // no need to cancel it
      delete this.conversations[convID];
    }
  }

  async callWithRefresh<
    Params extends { fresh?: boolean },
    Result extends { stale?: boolean }
  >(rc: RequestCreator<Params, Result>, params: Params): Promise<Result> {
    const res = await this.call(rc, params);
    if (res.stale) {
      return await this.call(rc, { ...params, fresh: true });
    } else {
      return res;
    }
  }

  async query<Result>(
    qc: QueryCreator<void, Result>,
    params?: void
  ): Promise<Result>;

  async query<Params, Result>(
    qc: QueryCreator<Params, Result>,
    params: Params
  ): Promise<Result>;

  async query<Params, Result>(
    qc: QueryCreator<Params, Result>,
    params: Params
  ): Promise<Result> {
    let query: QueryRequest<Params> = {
      id: this.generateID(), // shared with butler calls, why not
      method: qc.__method,
      params,
    };
    this.send(packets.queryRequest, query);

    return new Promise((resolve, reject) => {
      this.outboundQueries[query.id] = { resolve, reject };
    });
  }

  async showModal<Params, Result>(
    mc: ModalCreator<Params, Result>,
    params: Params
  ): Promise<Result> {
    return await this.query(queries.showModal, { mc, params });
  }
}

export type SetupFunc = (conv: Conversation) => void;