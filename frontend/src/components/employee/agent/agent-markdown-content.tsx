import ReactMarkdown from 'react-markdown';

interface AgentMarkdownContentProps {
  content: string;
}

export function AgentMarkdownContent({ content }: AgentMarkdownContentProps) {
  return (
    <div className="prose prose-slate max-w-none text-sm leading-7 prose-headings:mb-2 prose-headings:mt-4 prose-headings:text-slate-950 prose-p:my-2 prose-ul:my-2 prose-li:my-1 prose-strong:text-slate-950 prose-code:rounded-md prose-code:bg-slate-100 prose-code:px-1.5 prose-code:py-0.5 prose-code:text-sky-700 prose-pre:rounded-2xl prose-pre:border prose-pre:border-slate-200 prose-pre:bg-slate-950">
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  );
}
