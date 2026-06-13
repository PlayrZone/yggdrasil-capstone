import React, { useCallback, useEffect, useState } from 'react';
import type { ReportMeta } from '../preload/index.js';

/**
 * The shared research log. Reports are Markdown files both you and the AI
 * engineer read and write (the AI writes via MCP write_report; you write here).
 * The same files, the same channel — a conversation in documents.
 */
export function ReportsView(): React.ReactElement {
  const [list, setList] = useState<ReportMeta[]>([]);
  const [slug, setSlug] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [author, setAuthor] = useState('you');
  const [dirty, setDirty] = useState(false);

  const refresh = useCallback(async () => {
    const lab = window.lab;
    if (!lab) return;
    setList(await lab.listReports());
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, 4000); // pick up the AI's writes
    return () => clearInterval(id);
  }, [refresh]);

  const open = useCallback(async (s: string) => {
    const lab = window.lab;
    if (!lab) return;
    const r = await lab.readReport(s);
    if (!r) return;
    setSlug(s);
    setTitle(r.meta.title);
    setAuthor(r.meta.author);
    setBody(r.body);
    setDirty(false);
  }, []);

  const newReport = useCallback(() => {
    setSlug(null);
    setTitle('Untitled report');
    setAuthor('you');
    setBody('');
    setDirty(true);
  }, []);

  const save = useCallback(async () => {
    const lab = window.lab;
    if (!lab || !title.trim()) return;
    const savedSlug = await lab.writeReport(title.trim(), body, slug ?? undefined);
    setSlug(savedSlug);
    setDirty(false);
    void refresh();
  }, [title, body, slug, refresh]);

  return (
    <div className="reports">
      <div className="rlist">
        <div className="rhead">
          <label>Reports</label>
          <button className="go" onClick={newReport}>+ New</button>
        </div>
        <ul>
          {list.map((r) => (
            <li key={r.slug} className={r.slug === slug ? 'sel' : ''} onClick={() => open(r.slug)}>
              <b>{r.title}</b>
              <span>{r.author}</span>
            </li>
          ))}
          {list.length === 0 && <li className="empty">No reports yet. Create one, or ask the AI to write one.</li>}
        </ul>
      </div>
      <div className="reditor">
        {slug === null && !dirty ? (
          <div className="rempty">Select a report, or create a new one. The AI engineer can read and write these too.</div>
        ) : (
          <>
            <div className="rtoolbar">
              <input className="rtitle" value={title} onChange={(e) => { setTitle(e.target.value); setDirty(true); }} placeholder="Report title" />
              <span className="rauthor">by {author}</span>
              <button className="go" disabled={!dirty} onClick={save}>{dirty ? 'Save' : 'Saved'}</button>
            </div>
            <textarea
              className="rbody"
              value={body}
              onChange={(e) => { setBody(e.target.value); setDirty(true); }}
              placeholder="Write in Markdown…"
              spellCheck={false}
            />
          </>
        )}
      </div>
    </div>
  );
}
