"use client";
import React, { useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';

import { Button, Progress, Tooltip } from 'antd';
import {
  FilePdfOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  DownloadOutlined,
  CloseOutlined,
  MinusOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { usePdfGenerator } from '@/lib/hooks/usePdfGenerator';
import { clearDone,removeJob } from '@/redux/slices/Pdfjobslice';

// ─── Step labels ────────────────────────────────────────────────────────────────
const STEP_LABELS = [
  'Fetching member data…',
  'Processing records…',
  'Building PDF layout…',
  'Rendering fonts…',
  'Finalising…',
];

// ─── Single Job Row ─────────────────────────────────────────────────────────────
const JobRow = ({ job, onRetry, onRemove, onOpen }) => {
  const isLoading = job.status === 'loading';
  const isDone    = job.status === 'done';
  const isError   = job.status === 'error';

  const stepLabel = isLoading
    ? (STEP_LABELS[job.currentStep ?? 0] || 'Processing…')
    : isDone
    ? 'Completed successfully'
    : job.error || 'Generation failed';

  const formatElapsed = (s) => {
    if (!s) return '';
    const m   = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  };

  return (
    <div style={{ padding: '10px 12px', borderBottom: '1px solid #f0f0f0' }}>
      {/* Top row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
        <div style={{ flexShrink: 0, marginTop: 1 }}>
          {isLoading && <LoadingOutlined spin style={{ color: '#1677ff', fontSize: 14 }} />}
          {isDone    && <CheckCircleOutlined  style={{ color: '#52c41a', fontSize: 14 }} />}
          {isError   && <CloseCircleOutlined  style={{ color: '#ff4d4f', fontSize: 14 }} />}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 12, fontWeight: 500, color: '#1a1a1a',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {job.label}
          </div>
          <div style={{
            fontSize: 11, marginTop: 1,
            color: isError ? '#ff4d4f' : '#888',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {stepLabel}
            {job.elapsed > 0 && (
              <span style={{ marginLeft: 6, color: '#bbb' }}>· {formatElapsed(job.elapsed)}</span>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
          {isDone && job.url && (
            <Tooltip title="Open PDF">
              <Button
                type="text" size="small" icon={<DownloadOutlined />}
                style={{ color: '#1677ff', padding: '0 4px', height: 22 }}
                onClick={() => onOpen(job.url)}
              />
            </Tooltip>
          )}
          {isError && (
            <Tooltip title="Retry">
              <Button
                type="text" size="small" icon={<ReloadOutlined />}
                style={{ color: '#ff4d4f', padding: '0 4px', height: 22 }}
                onClick={() => onRetry(job)}
              />
            </Tooltip>
          )}
          {!isLoading && (
            <Tooltip title="Dismiss">
              <Button
                type="text" size="small" icon={<CloseOutlined />}
                style={{ color: '#bbb', padding: '0 4px', height: 22 }}
                onClick={() => onRemove(job.id)}
              />
            </Tooltip>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <Progress
        percent={job.progress || 0}
        showInfo={false}
        size={['100%', 3]}
        status={isError ? 'exception' : isDone ? 'success' : 'active'}
        strokeColor={isLoading ? { from: '#1677ff', to: '#69b1ff' } : undefined}
      />
    </div>
  );
};

// ─── Main Widget ────────────────────────────────────────────────────────────────
const GlobalPdfWidget = () => {
  const dispatch      = useDispatch();
  const jobs          = useSelector((s) => s.pdfJobs.jobs);
  const { retryJob }  = usePdfGenerator();
  const [collapsed, setCollapsed] = useState(false);

  const loadingCount = jobs.filter((j) => j.status === 'loading').length;
  const doneCount    = jobs.filter((j) => j.status === 'done').length;
  const errorCount   = jobs.filter((j) => j.status === 'error').length;

  if (jobs.length === 0) return null;

  const badgeColor = errorCount > 0 ? '#ff4d4f' : loadingCount > 0 ? '#1677ff' : '#52c41a';

  const summaryText = [
    loadingCount > 0 && `${loadingCount} generating`,
    doneCount    > 0 && `${doneCount} ready`,
    errorCount   > 0 && `${errorCount} failed`,
  ].filter(Boolean).join(' · ');

  return (
    <div style={{
      position:     'fixed',
      bottom:       24,
      right:        24,
      zIndex:       9999,
      width:        320,
      background:   '#fff',
      borderRadius: 12,
      boxShadow:    '0 8px 32px rgba(0,0,0,0.16), 0 2px 8px rgba(0,0,0,0.10)',
      border:       '1px solid #f0f0f0',
      overflow:     'hidden',
      fontFamily:   '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    }}>

      {/* ── Header ── */}
      <div
        style={{
          padding:       '10px 12px',
          display:       'flex',
          alignItems:    'center',
          gap:           8,
          cursor:        'pointer',
          borderBottom:  collapsed ? 'none' : '1px solid #f0f0f0',
          background:    '#fff',
          userSelect:    'none',
        }}
        onClick={() => setCollapsed((c) => !c)}
      >
        {/* Icon + badge */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <FilePdfOutlined style={{ fontSize: 18, color: '#1677ff' }} />
          <div style={{
            position:       'absolute',
            top:            -5,
            right:          -7,
            background:     badgeColor,
            color:          '#fff',
            borderRadius:   10,
            fontSize:       10,
            fontWeight:     700,
            minWidth:       16,
            height:         16,
            padding:        '0 4px',
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
            lineHeight:     1,
          }}>
            {jobs.length}
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: '#1a1a1a', lineHeight: 1.2 }}>
            PDF Generator
          </div>
          <div style={{ fontSize: 11, color: '#888', marginTop: 1 }}>{summaryText}</div>
        </div>

        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {doneCount > 0 && !collapsed && (
            <Tooltip title="Clear completed">
              <Button
                type="text" size="small"
                style={{ fontSize: 11, height: 22, padding: '0 6px', color: '#888' }}
                onClick={(e) => { e.stopPropagation(); dispatch(clearDone()); }}
              >
                Clear
              </Button>
            </Tooltip>
          )}
          <Button
            type="text" size="small"
            icon={<MinusOutlined style={{ fontSize: 12 }} />}
            style={{ color: '#bbb', padding: '0 4px', height: 22 }}
            onClick={(e) => { e.stopPropagation(); setCollapsed((c) => !c); }}
          />
        </div>
      </div>

      {/* ── Job list ── */}
      {!collapsed && (
        <div style={{ maxHeight: 340, overflowY: 'auto' }}>
          {jobs.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              onRetry={retryJob}
              onRemove={(id) => dispatch(removeJob(id))}
              onOpen={(url) => window.open(url, '_blank')}
            />
          ))}
        </div>
      )}

      {/* ── Shimmer bar when collapsed + loading ── */}
      {collapsed && loadingCount > 0 && (
        <div style={{
          height:           3,
          background:       'linear-gradient(90deg, #1677ff 0%, #69b1ff 50%, #1677ff 100%)',
          backgroundSize:   '200% 100%',
          animation:        'pdfShimmer 1.4s linear infinite',
        }} />
      )}

      <style>{`
        @keyframes pdfShimmer {
          0%   { background-position: 100% 0; }
          100% { background-position: -100% 0; }
        }
      `}</style>
    </div>
  );
};

export default GlobalPdfWidget;