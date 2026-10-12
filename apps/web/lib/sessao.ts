import { createContext } from "react";
import type { Session } from "./api";

export const SessaoContext = createContext<Session>({ authenticated: false, offline: false });
