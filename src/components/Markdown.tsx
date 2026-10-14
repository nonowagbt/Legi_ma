import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { isDesktop } from "../platform";

export async function openExternal(href: string) {
  if (isDesktop) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(href);
  } else {
    window.open(href, "_blank", "noopener,noreferrer");
  }
}

/** Affiche du Markdown ; si le texte est du JSON brut, il est présenté indenté. */
export default function Markdown({ text }: { text: string }) {
  const source = asPrettyJson(text) ?? text;
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(e) => {
                e.preventDefault();
                if (href && /^https?:\/\//.test(href)) void openExternal(href);
              }}
            >
              {children}
            </a>
          ),
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}

function asPrettyJson(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    return "```json\n" + JSON.stringify(JSON.parse(trimmed), null, 2) + "\n```";
  } catch {
    return null;
  }
}
