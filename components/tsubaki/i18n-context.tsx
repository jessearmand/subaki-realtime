// React binding for the string layer: AppShell provides `t` for the session
// language; every component reads it with useT().

import { createContext, useContext } from "react";
import { makeT, type Translate } from "@/lib/i18n";

export const I18nContext = createContext<Translate>(makeT("en"));

export const useT = (): Translate => useContext(I18nContext);
