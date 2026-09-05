import React from "react";
import ReactDOM from "react-dom/client";
import { ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import App from "./App";

const deploymentUrl = import.meta.env.VITE_CONVEX_URL;

if (!deploymentUrl) {
  throw new Error("Falta VITE_CONVEX_URL. Consulta .env.example para configurar Ora.");
}

const convex = new ConvexReactClient(deploymentUrl);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConvexAuthProvider client={convex}>
      <App />
    </ConvexAuthProvider>
  </React.StrictMode>,
);
