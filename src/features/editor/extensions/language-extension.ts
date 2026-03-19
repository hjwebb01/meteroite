import { Extension } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { json } from "@codemirror/lang-json";

export const getLanguageExtension = (fileName: string): Extension => {
    const extension = fileName.split(".").pop()?.toLowerCase();
    switch (extension) {
        case "js":
            return javascript();
        case "jsx":
            return javascript({ jsx: true });
        case "ts":
            return javascript({ typescript: true });
        case "tsx":
            return javascript({ typescript: true, jsx: true });
        case "html":
            return html();
        case "css":
            return css();
        case "md":
        case "mdx":
            return markdown();
        case "py":
            return python();
        case "json":
            return json();
        default:
            return [];
    }
};
