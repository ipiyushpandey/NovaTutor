import React, { useState, useEffect, useMemo } from 'react';
import { api } from '../lib/api.js';
import { History, BookOpen, Code2, GraduationCap, BrainCircuit, Search, Trash2, ChevronRight, Clock3, RotateCcw, Target } from '../icons.jsx';

function formatRelativeTime(dateString) {
  if (!dateString) return 'Recently';
  try {
    const diff = (Date.now() - new Date(dateString).getTime()) / 1000;
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return new Date(dateString).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return 'Recently';
  }
}

export default function LearningHistoryView({ user, go, onReopenTopic }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const loadHistory = async () => {
    setLoading(true);
    setError('');
    const isGuest = String(user?.role || '').toUpperCase() === 'GUEST';
    if (isGuest || !user?.token) {
      try {
        const guestKey = `nova_guest_history_${user?.id || 'guest'}`;
        const raw = localStorage.getItem(guestKey);
        const parsed = raw ? JSON.parse(raw) : [];
        const aiOnly = Array.isArray(parsed) ? parsed.filter(x => x.itemType === 'AI_TEACHER') : [];
        setItems(aiOnly);
      } catch {
        setItems([]);
      } finally {
        setLoading(false);
      }
      return;
    }

    try {
      const data = await api('/history');
      if (Array.isArray(data)) {
        const aiOnly = data.filter(x => x.itemType === 'AI_TEACHER');
        setItems(aiOnly);
        try {
          localStorage.setItem(`nova_user_history_${user.id}`, JSON.stringify(aiOnly));
        } catch {}
      } else {
        setItems([]);
      }
    } catch (err) {
      // Fallback to local storage cache if network is unavailable
      const localKey = `nova_user_history_${user.id}`;
      try {
        const raw = localStorage.getItem(localKey);
        const parsed = raw ? JSON.parse(raw) : [];
        const aiOnly = Array.isArray(parsed) ? parsed.filter(x => x.itemType === 'AI_TEACHER') : [];
        setItems(aiOnly);
      } catch {
        setItems([]);
      }
      const msg = String(err?.message || '');
      if (!msg.toLowerCase().includes('not found') && !msg.includes('404')) {
        setError('Could not sync history with cloud. Displaying your cached sessions.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadHistory();
    const onUpdated = () => loadHistory();
    window.addEventListener('nova:history-updated', onUpdated);
    return () => window.removeEventListener('nova:history-updated', onUpdated);
  }, [user?.id]);

  const handleDelete = async (id, e) => {
    e.stopPropagation();
    setConfirmDeleteId(null);
    setError('');
    const previousItems = items;
    const updated = items.filter(x => x.id !== id);
    setItems(updated);

    const isGuest = String(user?.role || '').toUpperCase() === 'GUEST';
    if (isGuest || !user?.token) {
      try {
        const guestKey = `nova_guest_history_${user?.id || 'guest'}`;
        localStorage.setItem(guestKey, JSON.stringify(updated));
      } catch {}
      return;
    }

    try {
      const localKey = `nova_user_history_${user.id}`;
      localStorage.setItem(localKey, JSON.stringify(updated));
      await api(`/history/${id}`, { method: 'DELETE' });
    } catch (err) {
      setItems(previousItems);
      try {
        const localKey = `nova_user_history_${user.id}`;
        localStorage.setItem(localKey, JSON.stringify(previousItems));
      } catch {}
      setError('Could not remove history entry right now. Please check your network connection.');
    }
  };

  const handleClearAll = async () => {
    setError('');
    const previousItems = items;
    setItems([]);
    setConfirmClear(false);

    const isGuest = String(user?.role || '').toUpperCase() === 'GUEST';
    if (isGuest || !user?.token) {
      try {
        const guestKey = `nova_guest_history_${user?.id || 'guest'}`;
        localStorage.removeItem(guestKey);
      } catch {}
      return;
    }

    try {
      const localKey = `nova_user_history_${user.id}`;
      localStorage.removeItem(localKey);
      await api('/history', { method: 'DELETE' });
    } catch (err) {
      setItems(previousItems);
      try {
        const localKey = `nova_user_history_${user.id}`;
        localStorage.setItem(localKey, JSON.stringify(previousItems));
      } catch {}
      setError('Could not clear history right now. Please check your network connection.');
    }
  };

  const filteredItems = useMemo(() => {
    return items.filter(item => {
      if (item.itemType !== 'AI_TEACHER') return false;
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return (
        (item.title && item.title.toLowerCase().includes(q)) ||
        (item.category && item.category.toLowerCase().includes(q))
      );
    });
  }, [items, search]);

  const getTypeIcon = () => <BrainCircuit size={16} />;
  const getTypeLabel = () => 'AI Teacher';

  return (
    <div className="learning-history-page">
      <div className="page-title">
        <span className="eyebrow">RECALL & CONTINUITY</span>
        <h1>
          Learning <span>History.</span>
        </h1>
        <p>
          Pick up right where you left off. Every completed AI Teacher session and conceptual deep dive is
          saved here so you can revisit and master it anytime.
        </p>
      </div>

      <div className="history-toolbar">
        <div className="history-search-wrap">
          <Search size={15} className="history-search-icon" />
          <input
            type="text"
            className="history-search-input"
            placeholder="Search AI Teacher sessions or concepts…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            aria-label="Search learning history"
          />
          {search && (
            <button type="button" className="text-btn history-clear-search" onClick={() => setSearch('')}>
              ✕
            </button>
          )}
        </div>

        <div className="history-count-badge" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 700, color: 'var(--muted)', padding: '6px 12px', background: 'var(--surface-2)', borderRadius: '99px', border: '1px solid var(--border)' }}>
          <BrainCircuit size={14} style={{ color: 'var(--accent)' }} />
          <span>{filteredItems.length} AI Session{filteredItems.length === 1 ? '' : 's'}</span>
        </div>

        {items.length > 0 && (
          <div className="history-actions">
            {!confirmClear ? (
              <button
                type="button"
                className="text-btn history-clear-btn"
                onClick={() => setConfirmClear(true)}
                title="Clear all learning history"
              >
                <Trash2 size={14} /> Clear history
              </button>
            ) : (
              <div className="history-confirm-clear">
                <span>Clear all history?</span>
                <button type="button" className="danger-btn compact" onClick={handleClearAll}>
                  Yes, clear
                </button>
                <button type="button" className="secondary compact" onClick={() => setConfirmClear(false)}>
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="error settings-error" role="alert">
          {error}
        </div>
      )}

      {loading && items.length === 0 && (
        <div className="history-grid">
          {[1, 2, 3, 4].map(n => (
            <div key={n} className="panel skeleton skeleton-card" style={{ minHeight: '110px' }} />
          ))}
        </div>
      )}

      {!loading && filteredItems.length === 0 && (
        <div className="panel empty history-empty">
          <History size={48} />
          <b>{search ? 'No matching AI sessions found.' : 'No AI Teacher sessions yet.'}</b>
          <span>
            {search
              ? 'Try a different search keyword.'
              : 'As you ask questions and study concepts with Nova in the AI Teacher Studio, your sessions will appear here.'}
          </span>
          {!search && (
            <button type="button" className="primary" onClick={() => go('learning-studio')}>
              Open AI Teacher Studio <ChevronRight size={14} />
            </button>
          )}
        </div>
      )}

      {!loading && filteredItems.length > 0 && (
        <div className="history-grid">
          {filteredItems.map(item => (
            <article
              key={item.id}
              className="history-card panel"
              onClick={() => onReopenTopic?.(item)}
              role="button"
              tabIndex={0}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onReopenTopic?.(item);
                }
              }}
              aria-label={`Reopen topic: ${item.title}`}
            >
              <div className="history-card-header">
                <span className={`history-type-badge type-${item.itemType?.toLowerCase()}`}>
                  {getTypeIcon(item.itemType)}
                  {getTypeLabel(item.itemType)}
                </span>
                <div className="history-card-time" title={item.updatedAt}>
                  <Clock3 size={12} />
                  <span>{formatRelativeTime(item.updatedAt)}</span>
                </div>
              </div>

              <div className="history-card-body">
                <h3 className="history-card-title">{item.title}</h3>
                {item.category && <span className="history-card-category">{item.category}</span>}
              </div>

              <div className="history-card-footer">
                <span className="history-reopen-link">
                  Reopen content <ChevronRight size={13} />
                </span>
                {confirmDeleteId === item.id ? (
                  <div className="history-item-confirm" onClick={e => e.stopPropagation()}>
                    <span className="history-confirm-prompt">Remove?</span>
                    <button
                      type="button"
                      className="danger-btn compact mini"
                      onClick={e => handleDelete(item.id, e)}
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      className="secondary compact mini"
                      onClick={e => {
                        e.stopPropagation();
                        setConfirmDeleteId(null);
                      }}
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="icon-btn history-delete-item-btn"
                    onClick={e => {
                      e.stopPropagation();
                      setConfirmDeleteId(item.id);
                    }}
                    title="Remove from history"
                    aria-label="Remove item from history"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
