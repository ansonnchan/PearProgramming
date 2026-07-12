import { ChevronDown, ChevronRight, Folder, Trash2 } from 'lucide-react';
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
    return <div className="empty-tree">No files yet</div>;
  }
  return <>{tree.map((node) => <TreeRow {...props} key={node.path} node={node} />)}</>;
}

function TreeRow({ node, activeFileId, expandedFolders, onDeletePath, onFileSelect, onToggleFolder, depth = 0 }: Omit<FileTreeProps, 'files'> & { node: TreeNode; depth?: number }) {
  if (node.file) {
    if (node.name === '.gitkeep') return null;
    return (
      <div className={`tree-row-wrapper ${activeFileId === node.file.id ? 'file-row-active' : ''}`}>
        <button className="tree-row file-row" onClick={() => onFileSelect(node.file!.id)} style={{ paddingLeft: 10 + depth * 14 }} type="button">
          <span className={`language-dot ${languageClass(node.file.language)}`} />
          <span>{node.name}</span>
        </button>
        <button className="tree-delete-button" onClick={() => onDeletePath(node.file!.path, 'file')} title={`Delete ${node.name}`} type="button"><Trash2 size={12} /></button>
      </div>
    );
  }

  const expanded = expandedFolders.has(node.path);
  return (
    <div>
      <div className="tree-row-wrapper">
        <button className="tree-row folder-row" onClick={() => onToggleFolder(node.path)} style={{ paddingLeft: 8 + depth * 14 }} type="button">
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<Folder size={14} /><span>{node.name}</span>
        </button>
        <button className="tree-delete-button" onClick={() => onDeletePath(node.path, 'folder')} title={`Delete ${node.name}`} type="button"><Trash2 size={12} /></button>
      </div>
      {expanded && node.children.map((child) => (
        <TreeRow activeFileId={activeFileId} depth={depth + 1} expandedFolders={expandedFolders} key={child.path} node={child}
          onDeletePath={onDeletePath} onFileSelect={onFileSelect} onToggleFolder={onToggleFolder} />
      ))}
    </div>
  );
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
