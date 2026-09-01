import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { applyTheme, initialTheme } from "./themes.ts";

/* тема — до первой отрисовки, чтобы не было вспышки дефолтной */
applyTheme(initialTheme());

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
