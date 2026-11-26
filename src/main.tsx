import React from "react";
import ReactDOM from "react-dom/client";
import { HubSession } from "./HubSession";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "./styles.css";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HubSession />
  </React.StrictMode>,
);
