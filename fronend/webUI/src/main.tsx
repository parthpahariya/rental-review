import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import DeleteData from "./legal/DeleteData";
import PrivacyPolicy from "./legal/PrivacyPolicy";
import { legalPageFor } from "./legal/site";
import "./styles.css";

// The legal pages have their own addresses (/privacy, /delete-data) so they
// can be linked from Google's sign-in consent screen and shared directly.
const legal = legalPageFor(window.location.pathname);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {legal === "privacy" ? (
      <PrivacyPolicy />
    ) : legal === "delete-data" ? (
      <DeleteData />
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
