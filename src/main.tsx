import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { applyTheme, initialTheme } from "./themes";

/* применяем сохранённую тему до первой отрисовки — без вспышки */
applyTheme(initialTheme());

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
