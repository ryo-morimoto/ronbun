import { StartClient } from "@tanstack/react-start/client";
import { hydrateRoot } from "react-dom/client";
import { getRouter } from "./router";

const router = getRouter();

// @ts-expect-error - StartClient types are not fully compatible
hydrateRoot(document.getElementById("root")!, <StartClient router={router} />);
