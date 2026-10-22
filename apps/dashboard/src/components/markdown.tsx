import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

// Model output is untrusted. react-markdown never renders raw HTML (it is
// shown as text because no rehype-raw plugin is used) and its default URL
// transform drops javascript: and other unsafe link targets.
const components: Components = {
  h1: ({ node: _node, ...props }) => <h3 className="mt-3 text-base font-semibold text-zinc-900 first:mt-0" {...props} />,
  h2: ({ node: _node, ...props }) => <h4 className="mt-3 text-sm font-semibold text-zinc-900 first:mt-0" {...props} />,
  h3: ({ node: _node, ...props }) => <h5 className="mt-3 text-sm font-semibold text-zinc-900 first:mt-0" {...props} />,
  h4: ({ node: _node, ...props }) => <h6 className="mt-2 text-sm font-medium text-zinc-900 first:mt-0" {...props} />,
  p: ({ node: _node, ...props }) => <p className="my-2 first:mt-0 last:mb-0" {...props} />,
  ul: ({ node: _node, ...props }) => <ul className="my-2 list-disc space-y-1 pl-5 first:mt-0 last:mb-0" {...props} />,
  ol: ({ node: _node, ...props }) => <ol className="my-2 list-decimal space-y-1 pl-5 first:mt-0 last:mb-0" {...props} />,
  li: ({ node: _node, ...props }) => <li className="pl-0.5 marker:text-zinc-400" {...props} />,
  strong: ({ node: _node, ...props }) => <strong className="font-semibold text-zinc-900" {...props} />,
  a: ({ node: _node, ...props }) => (
    <a className="font-medium text-indigo-600 underline underline-offset-2 hover:text-indigo-700" target="_blank" rel="noopener noreferrer nofollow" {...props} />
  ),
  blockquote: ({ node: _node, ...props }) => <blockquote className="my-2 border-l-2 border-zinc-200 pl-3 text-zinc-600" {...props} />,
  hr: () => <hr className="my-3 border-zinc-200" />,
  // Fenced blocks arrive as <pre><code>; inline code is a bare <code>.
  pre: ({ node: _node, ...props }) => (
    <pre className="my-2 max-h-80 overflow-auto rounded-md border border-zinc-200 bg-zinc-50 p-3 font-mono text-xs leading-relaxed text-zinc-800 [&_code]:bg-transparent [&_code]:p-0" {...props} />
  ),
  code: ({ node: _node, className, ...props }) => (
    <code className={cn("rounded bg-zinc-100 px-1 py-0.5 font-mono text-[0.85em] text-zinc-800", className)} {...props} />
  ),
  table: ({ node: _node, ...props }) => (
    <div className="my-2 overflow-x-auto">
      <table className="min-w-full border-collapse text-left text-xs" {...props} />
    </div>
  ),
  th: ({ node: _node, ...props }) => <th className="border-b border-zinc-200 px-2 py-1.5 font-medium text-zinc-600" {...props} />,
  td: ({ node: _node, ...props }) => <td className="border-b border-zinc-100 px-2 py-1.5 text-zinc-800" {...props} />,
};

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("min-w-0 break-words text-sm leading-relaxed text-zinc-800", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
