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

  const loadHistory = async () => {
    setLoading(true);
    setError('');
    const isGuest = String(user?.role || '').toUpperCase() === 'GUEST';
    if (isGuest || !user?.token) {
      try {
        const guestKey = `nova_guest_history_${user?.id || 'guest'}`;
        const raw = localStorage.getItem(guestKey);
        setItems(raw ? JSON.parse(raw) : []);
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
        setItems(data);
      } else {
        setItems([]);
      }
    } catch (err) {
      // Fallback to local storage cache if network is unavailable
      try {
        const localKey = `nova_user_history_${user.id}`;
        const raw = localStorage.getItem(localKey);
        setItems(raw ? JSON.parse(raw) : []);
      } catch {
        setItems([]);
      }
      setError(err.message || 'Could not load learning history.');
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
    const isGuest = String(user?.role || '').toUpperCase() === 'GUEST';
    if (isGuest || !user?.token) {
      try {
        const guestKey = `nova_guest_history_${user?.id || 'guest'}`;
        const updated = items.filter(x => x.id !== id);
        localStorage.setItem(guestKey, JSON.stringify(updated));
        setItems(updated);
      } catch {}
      return;
    }
    try {
      await api(`/history/${id}`, { method: 'DELETE' });
      setItems(prev => prev.filter(x => x.id !== id));
    } catch (err) {
      setError(err.message || 'Could not delete history entry.');
    }
  };

  const handleClearAll = async () => {
    const isGuest = String(user?.role || '').toUpperCase() === 'GUEST';
    if (isGuest || !user?.token) {
      try {
        const guestKey = `nova_guest_history_${user?.id || 'guest'}`;
        localStorage.removeItem(guestKey);
        setItems([]);
        setConfirmClear(false);
      } catch {}
      return;
    }
    try {
      await api('/history', { method: 'DELETE' });
      setItems([]);
      setConfirmClear(false);
    } catch (err) {
      setError(err.message || 'Could not clear history.');
    }
  };

  const filteredItems = useMemo(() => {
    return items.filter(item => {
      const matchesFilter =
        filter === 'ALL' ||
        (filter === 'LESSON' && item.itemType === 'LESSON') ||
        (filter === 'DSA' && item.itemType === 'DSA') ||
        (filter === 'GATE_CSE' && item.itemType === 'GATE_CSE') ||
        (filter === 'AI_TEACHER' && item.itemType === 'AI_TEACHER');

      const q = search.trim().toLowerCase();
      const matchesSearch =
        !q ||
        (item.title && item.title.toLowerCase().includes(q)) ||
        (item.category && item.category.toLowerCase().includes(q));

      return matchesFilter && matchesSearch;
    });
  }, [items, filter, search]);

  const getTypeIcon = type => {
    switch (type) {
      case 'LESSON':
        return <BookOpen size={16} />;
      case 'DSA':
        return <Code2 size={16} />;
      case 'GATE_CSE':
        return <GraduationCap size={16} />;
      case 'AI_TEACHER':
        return <BrainCircuit size={16} />;
      default:
        return <History size={16} />;
    }
  };

  const getTypeLabel = type => {
    switch (type) {
      case 'LESSON':
        return 'Course Lesson';
      case 'DSA':
        return 'DSA Problem';
      case 'GATE_CSE':
        return 'GATE CSE';
      case 'AI_TEACHER':
        return 'AI Teacher';
      default:
        return 'Learning Topic';
    }
  };

  return (
    <div className="learning-history-page">
      <div className="page-title">
        <span className="eyebrow">RECALL & CONTINUITY</span>
        <h1>
          Learning <span>History.</span>
        </h1>
        <p>
          Pick up right where you left off. Every lesson, problem, exam topic, and AI tutor session you study is
          saved here so you can revisit and master it.
        </p>
      </div>

      <div className="history-toolbar">
        <div className="history-search-wrap">
          <Search size={15} className="history-search-icon" />
          <input
            type="text"
            className="history-search-input"
            placeholder="Search studied topics or courses…"
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

        <div className="history-filter-pills">
          {[
            ['ALL', 'All Topics'],
            ['LESSON', 'Courses & Lessons'],
            ['DSA', 'DSA Practice'],
            ['GATE_CSE', 'GATE CSE'],
            ['AI_TEACHER', 'AI Teacher'],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`pill-btn ${filter === key ? 'active' : ''}`}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
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
          <b>{search ? 'No matching topics found.' : 'No learning history yet.'}</b>
          <span>
            {search
              ? 'Try a different search keyword or filter.'
              : 'As you open lessons, solve DSA challenges, or ask questions in AI Teacher, your studied topics will appear here.'}
          </span>
          {!search && (
            <button type="button" className="primary" onClick={() => go('courses')}>
              Explore Courses <ChevronRight size={14} />
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
                <button
                  type="button"
                  className="icon-btn history-delete-item-btn"
                  onClick={e => handleDelete(item.id, e)}
                  title="Remove from history"
                  aria-label="Remove item from history"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
