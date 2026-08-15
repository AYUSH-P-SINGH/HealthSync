import React, { useState } from 'react';
import { Send, Sparkles, AlertCircle } from 'lucide-react';

const SUGGESTED_PROMPTS = [
  'Explain my latest blood report in simple English',
  'What was my HbA1c level in my last report?',
  'Compare my HbA1c test results over time',
  'What medications are mentioned in my records?',
];

export default function AIInput({ onSubmit, isLoading }) {
  const [query, setQuery] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!query.trim() || isLoading) return;
    onSubmit(query.trim());
    setQuery('');
  };

  const handleSelectPrompt = (promptText) => {
    setQuery(promptText);
    onSubmit(promptText);
  };

  return (
    <div className="space-y-3">
      <form onSubmit={handleSubmit} className="relative flex items-center">
        <div className="absolute left-3.5 text-indigo-400">
          <Sparkles className="w-5 h-5 animate-pulse" />
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask HealthSync to summarize, compare, or explain your medical records..."
          disabled={isLoading}
          className="w-full pl-11 pr-24 py-3 bg-slate-900/90 border border-slate-700/80 rounded-xl text-slate-100 placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={!query.trim() || isLoading}
          className="absolute right-2 px-4 py-1.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-medium rounded-lg flex items-center gap-1.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-md shadow-indigo-900/30"
        >
          {isLoading ? (
            <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <>
              <span>Ask</span>
              <Send className="w-3.5 h-3.5" />
            </>
          )}
        </button>
      </form>

      {/* Suggested Quick Question Pills */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <span className="text-xs font-medium text-slate-400 flex items-center gap-1">
          Suggested:
        </span>
        {SUGGESTED_PROMPTS.map((prompt, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => handleSelectPrompt(prompt)}
            disabled={isLoading}
            className="text-xs bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/60 text-slate-300 hover:text-indigo-300 px-2.5 py-1 rounded-lg transition-colors text-left"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}
