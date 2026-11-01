import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import type {
  AppState,
  ChatRecord,
  ChatSummary,
  PermissionRequest,
  Settings,
  StorageUsage,
  Task,
  TimelineItem,
  SharedAgentEvent,
} from "../types";
import { applyEventToTimeline } from "../../../shared/timelineModel";

export interface XtracState {
  ready: boolean;
  settings: Settings | null;
  projects: import("../types").Project[];
  chats: ChatSummary[];
  tasks: Task[];
  usage: StorageUsage | null;
  activeChatId: string | null;
  activeChat: ChatRecord | null;
  activeTimeline: TimelineItem[];
  permission: PermissionRequest | null;
  error: string | null;
  busyChats: Set<string>;
  models: string[];
  setActiveChatId: (id: string | null) => void;
  setError: (msg: string | null) => void;
  refresh: () => Promise<void>;
  refreshUsage: () => Promise<void>;
  refreshModels: () => Promise<void>;
  sendPrompt: (text: string, images?: string[]) => Promise<void>;
  cancel: () => Promise<void>;
  retryLast: () => Promise<void>;
  answerPermission: (allow: boolean, always?: boolean) => Promise<void>;
  setChatApproval: (mode: "ask" | "auto") => Promise<void>;
  setChatModel: (model: string) => Promise<void>;
  deleteChat: (id: string) => Promise<void>;
  deleteChats: (ids: string[]) => Promise<void>;
  archiveChats: (ids: string[]) => Promise<void>;
  moveChat: (id: string, projectId: string) => Promise<void>;
  renameChat: (id: string, title: string) => Promise<void>;
  renameProject: (id: string, name: string) => Promise<void>;
  deleteProject: (id: string, alsoDeleteChats?: boolean) => Promise<void>;
}

/** Central renderer state + event wiring. All live agent updates flow through here. */
export function useXtrac(): XtracState {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [projects, setProjects] = useState<import("../types").Project[]>([]);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [activeChat, setActiveChat] = useState<ChatRecord | null>(null);
  const [activeTimeline, setActiveTimeline] = useState<TimelineItem[]>([]);
  const [permission, setPermission] = useState<PermissionRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>([]);

  // Live timelines for every open chat, incl. in-flight ones in the background.
  const timelines = useRef(new Map<string, TimelineItem[]>());
  const activeChatIdRef = useRef<string | null>(null);
  activeChatIdRef.current = activeChatId;

  const refresh = useCallback(async () => {
    const state: AppState = await api.getState();
    setSettings(state.settings);
    setProjects(state.projects);
    setChats(state.chats);
    setTasks(state.tasks);
    setUsage(state.usage);
    setReady(true);
  }, []);

  const refreshUsage = useCallback(async () => {
    setUsage(await api.storageUsage());
  }, []);

  const refreshModels = useCallback(async () => {
    try {
      const info = await api.listModels();
      const pool = info.ollama.concat(info.llamacpp);
      setModels(pool);
    } catch {
      /* backend probe failed; leave list as-is */
    }
  }, []);

  const openChat = useCallback(async (id: string) => {
    void api.setSessionActive(id);
    setActiveChatId(id);
    const rec = await api.getChat(id);
    if (!rec) {
      setActiveChat(null);
      setActiveTimeline([]);
      return;
    }
    setActiveChat(rec);
    setActiveTimeline(timelines.current.get(id) ?? rec.timeline);
    timelines.current.set(id, [...rec.timeline]);
  }, []);

  const setActiveChatIdSafe = useCallback(
    (id: string | null) => {
      if (!id) {
        setActiveChatId(null);
        setActiveChat(null);
        setActiveTimeline([]);
        return;
      }
      void openChat(id);
    },
    [openChat],
  );

  useEffect(() => {
    void (async () => {
      await refresh();
      await refreshModels();
      // M3: secondary windows boot straight into their bound chat (?chat=<id>).
      const bootChat = new URLSearchParams(window.location.search).get("chat");
      if (bootChat) await openChat(bootChat);
    })();

    const off = api.onEvent((payload) => {
      const p = payload as
        | { type: "agent-event"; chatId: string; ev: SharedAgentEvent }
        | { type: "chat-changed"; chat: ChatSummary & { timeline?: TimelineItem[] } }
        | { type: "chat-rewound"; chatId: string; timeline: TimelineItem[] }
        | { type: "init-chat"; chatId: string }
        | { type: "permission-request"; req: PermissionRequest };

      if (p.type === "init-chat") {
        void openChat(p.chatId);
        return;
      }

      if (p.type === "chat-rewound") {
        timelines.current.set(p.chatId, [...p.timeline]);
        if (p.chatId === activeChatIdRef.current) setActiveTimeline([...p.timeline]);
        return;
      }

      if (p.type === "agent-event") {
        const ev = p.ev;
        let tl = timelines.current.get(p.chatId);
        if (!tl) {
          tl = [];
          timelines.current.set(p.chatId, tl);
        }
        applyEventToTimeline(tl, ev);
        if (ev.type === "plan" && p.chatId === activeChatIdRef.current) {
          setActiveChat((prev) => (prev && prev.id === p.chatId ? { ...prev, plan: ev.entries } : prev));
        }
        if (p.chatId === activeChatIdRef.current) {
          setActiveTimeline([...tl]);
        }
        if (ev.type === "turn-end") {
          void refresh(); // refresh summaries/usage after each turn
        }
        return;
      }

      if (p.type === "chat-changed") {
        setChats((prev) => {
          const next = prev.filter((c) => c.id !== p.chat.id);
          const { timeline: _ignored, messages: _m, ...summary } = p.chat as ChatRecord;
          next.unshift(summary);
          return next;
        });
        if (p.chat.id === activeChatIdRef.current) {
          setActiveChat((prev) =>
            prev && prev.id === p.chat.id ? { ...prev, ...p.chat } as ChatRecord : prev,
          );
        }
        return;
      }

      if (p.type === "permission-request") {
        setPermission(p.req);
      }
    });

    return off;
  }, [refresh]);

  const sendPrompt = useCallback(
    async (text: string, images?: string[]) => {
      if (!activeChatId) return;
      const res = await api.sendPrompt(activeChatId, text, images);
      if (!res.accepted && res.reason) setError(res.reason);
    },
    [activeChatId],
  );

  const cancel = useCallback(async () => {
    if (activeChatId) await api.cancel(activeChatId);
  }, [activeChatId]);

  const retryLast = useCallback(async () => {
    if (!activeChatId) return;
    await api.retryChat(activeChatId);
  }, [activeChatId]);

  const answerPermission = useCallback(async (allow: boolean, always?: boolean) => {
    const req = permission;
    setPermission(null);
    if (!req) return;
    await api.approve(req.requestId, allow);
    if (allow && always) {
      try {
        await api.allowAlways(req.chatId, req.toolName, req.args);
        await refresh();
      } catch (e) {
        setError((e as Error).message);
      }
    }
  }, [permission, refresh]);

  const setChatApproval = useCallback(async (mode: "ask" | "auto") => {
    if (!activeChatId) return;
    const rec = await api.setChatApproval(activeChatId, mode);
    setActiveChat((prev) => (prev && prev.id === rec.id ? rec : prev));
    setChats((prev) => prev.map((c) => (c.id === rec.id ? rec : c)));
  }, [activeChatId]);

  const setChatModel = useCallback(
    async (model: string) => {
      if (!activeChatId) return;
      const rec = await api.setChatModel(activeChatId, model);
      setActiveChat((prev) => (prev && prev.id === rec.id ? rec : prev));
      setChats((prev) => prev.map((c) => (c.id === rec.id ? rec : c)));
    },
    [activeChatId],
  );

  const deleteChat = useCallback(
    async (id: string) => {
      await api.deleteChat(id);
      timelines.current.delete(id);
      if (activeChatIdRef.current === id) {
        setActiveChatId(null);
        setActiveChat(null);
        setActiveTimeline([]);
      }
      await refresh();
    },
    [refresh],
  );

  const renameChat = useCallback(
    async (id: string, title: string) => {
      const rec = await api.renameChat(id, title);
      if (rec && activeChatIdRef.current === id) setActiveChat((p) => (p ? { ...p, title: rec.title } : p));
      await refresh();
    },
    [refresh],
  );

  const deleteProject = useCallback(
    async (id: string, alsoDeleteChats?: boolean) => {
      await api.deleteProject(id, alsoDeleteChats);
      await refresh();
    },
    [refresh],
  );

  const deleteChats = useCallback(
    async (ids: string[]) => {
      await api.deleteChats(ids);
      for (const id of ids) timelines.current.delete(id);
      if (activeChatIdRef.current && ids.includes(activeChatIdRef.current)) {
        setActiveChatId(null);
        setActiveChat(null);
        setActiveTimeline([]);
      }
      await refresh();
    },
    [refresh],
  );

  const archiveChats = useCallback(
    async (ids: string[]) => {
      await api.archiveChats(ids);
      for (const id of ids) timelines.current.delete(id);
      if (activeChatIdRef.current && ids.includes(activeChatIdRef.current)) {
        setActiveChatId(null);
        setActiveChat(null);
        setActiveTimeline([]);
      }
      await refresh();
    },
    [refresh],
  );

  const renameProject = useCallback(
    async (id: string, name: string) => {
      await api.renameProject(id, name);
      await refresh();
    },
    [refresh],
  );

  const moveChat = useCallback(
    async (id: string, projectId: string) => {
      await api.moveChat(id, projectId);
      await refresh();
    },
    [refresh],
  );

  const busyChats = new Set(chats.filter((c) => c.status === "running").map((c) => c.id));

  return {
    ready,
    settings,
    projects,
    chats,
    tasks,
    usage,
    activeChatId,
    activeChat,
    activeTimeline,
    permission,
    error,
    busyChats,
    models,
    setActiveChatId: setActiveChatIdSafe,
    setError,
    refresh,
    refreshUsage,
    refreshModels,
    sendPrompt,
    cancel,
    retryLast,
    answerPermission,
    setChatApproval,
    setChatModel,
    deleteChat,
    deleteChats,
    archiveChats,
    moveChat,
    renameChat,
    renameProject,
    deleteProject,
  };
}
