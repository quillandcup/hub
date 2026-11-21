"use client";

import { createContext, useContext } from "react";

/** True inside the left panel, where the block's fields are shown under its own Back bar: the path above the fields (the right panel's) is then not drawn. */
export const FieldsInLeftPanel = createContext(false);
export const useFieldsInLeftPanel = () => useContext(FieldsInLeftPanel);
