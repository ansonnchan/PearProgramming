import { Braces, ChevronDown, ChevronRight, FileCode2, FileText, Folder, Trash2 } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { languageClass } from '../../language';
import type { WorkspaceFile } from '../../types';

type TreeNode = { name: string; path: string; children: TreeNode[]; file?: WorkspaceFile };
type MutableTreeNode = { name: string; path: string; children: Map<string, MutableTreeNode>; file?: WorkspaceFile };

type FileTreeProps = {
  activeFileId: string;
  expandedFolders: Set<string>;
  files: WorkspaceFile[];
  onDeletePath: (path: string, kind: 'file' | 'folder') => void;
  onFileSelect: (fileId: string) => void;
  onToggleFolder: (path: string) => void;
};

export function FileTree(props: FileTreeProps) {
  const tree = buildTree(props.files);
  if (tree.length === 0) {
    return <div className="empty-tree" role="status">No workspace files yet</div>;
  }
  return <div aria-label="Workspace files" className="tree-items" role="tree">{tree.map((node) => <TreeRow {...props} key={node.path} node={node} />)}</div>;
}

function TreeRow({ node, activeFileId, expandedFolders, onDeletePath, onFileSelect, onToggleFolder, depth = 0 }: Omit<FileTreeProps, 'files'> & { node: TreeNode; depth?: number }) {
  if (node.file) {
    if (node.name === '.gitkeep') return null;
    return (
      <div className={`tree-row-wrapper ${activeFileId === node.file.id ? 'file-row-active' : ''}`}>
        <button
          aria-level={depth + 1}
          aria-selected={activeFileId === node.file.id}
          className="tree-row file-row"
          data-tree-depth={depth}
          onClick={() => onFileSelect(node.file!.id)}
          onKeyDown={(event) => handleTreeKeyDown(event, { depth })}
          role="treeitem"
          style={{ paddingLeft: 12 + depth * 15 }}
          type="button"
        >
          <span className={`tree-file-icon ${languageClass(node.file.language)}`}>{fileIcon(node.file.path)}</span>
          <span>{node.name}</span>
        </button>
        <button aria-label={`Delete ${node.name}`} className="tree-delete-button" onClick={() => onDeletePath(node.file!.path, 'file')} title={`Delete ${node.name}`} type="button"><Trash2 size={12} /></button>
      </div>
    );
  }

  const expanded = expandedFolders.has(node.path);
  return (
    <div>
      <div className="tree-row-wrapper">
        <button
          aria-expanded={expanded}
          aria-level={depth + 1}
          className="tree-row folder-row"
          data-tree-depth={depth}
          onClick={() => onToggleFolder(node.path)}
          onKeyDown={(event) => handleTreeKeyDown(event, { depth, expanded, onToggle: () => onToggleFolder(node.path) })}
          role="treeitem"
          style={{ paddingLeft: 10 + depth * 15 }}
          type="button"
        >
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<Folder size={14} /><span>{node.name}</span>
        </button>
        <button aria-label={`Delete ${node.name}`} className="tree-delete-button" onClick={() => onDeletePath(node.path, 'folder')} title={`Delete ${node.name}`} type="button"><Trash2 size={12} /></button>
      </div>
      {expanded && (
        <div role="group">
          {node.children.map((child) => (
            <TreeRow activeFileId={activeFileId} depth={depth + 1} expandedFolders={expandedFolders} key={child.path} node={child}
              onDeletePath={onDeletePath} onFileSelect={onFileSelect} onToggleFolder={onToggleFolder} />
          ))}
        </div>
      )}
    </div>
  );
}

function handleTreeKeyDown(event: KeyboardEvent<HTMLButtonElement>, options: { depth: number; expanded?: boolean; onToggle?: () => void }) {
  const tree = event.currentTarget.closest('[role="tree"]');
  const items = tree ? Array.from(tree.querySelectorAll<HTMLButtonElement>('[role="treeitem"]')) : [];
  const currentIndex = items.indexOf(event.currentTarget);
  const focusItem = (index: number) => items[Math.max(0, Math.min(index, items.length - 1))]?.focus();

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    focusItem(currentIndex + 1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    focusItem(currentIndex - 1);
  } else if (event.key === 'Home') {
    event.preventDefault();
    focusItem(0);
  } else if (event.key === 'End') {
    event.preventDefault();
    focusItem(items.length - 1);
  } else if (event.key === 'ArrowRight' && options.onToggle) {
    event.preventDefault();
    if (!options.expanded) {
      options.onToggle();
    } else {
      const next = items[currentIndex + 1];
      if (Number(next?.dataset.treeDepth) > options.depth) next.focus();
    }
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault();
    if (options.onToggle && options.expanded) {
      options.onToggle();
      return;
    }
    for (let index = currentIndex - 1; index >= 0; index -= 1) {
      if (Number(items[index].dataset.treeDepth) < options.depth) {
        items[index].focus();
        break;
      }
    }
  }
}

function fileIcon(path: string) {
  const extension = path.split('.').pop()?.toLowerCase();
  if (extension === 'json') return <Braces size={14} />;
  if (extension === 'md' || extension === 'txt') return <FileText size={14} />;
  return <FileCode2 size={14} />;
}

export function buildTree(files: WorkspaceFile[]): TreeNode[] {
  const root: MutableTreeNode = { name: '', path: '', children: new Map() };
  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean);
    let cursor = root;
    let currentPath = '';
    parts.forEach((part, index) => {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      if (!cursor.children.has(part)) cursor.children.set(part, { name: part, path: currentPath, children: new Map() });
      cursor = cursor.children.get(part)!;
      if (index === parts.length - 1) cursor.file = file;
    });
  }
  return [...root.children.values()].map(toTreeNode);
}

function toTreeNode(node: MutableTreeNode): TreeNode {
  return {
    name: node.name, path: node.path, file: node.file,
    children: [...node.children.values()]
      .sort((a, b) => Number(Boolean(a.file)) - Number(Boolean(b.file)) || a.name.localeCompare(b.name))
      .map(toTreeNode)
  };
}
