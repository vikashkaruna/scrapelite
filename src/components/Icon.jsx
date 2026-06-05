// Icon.jsx — thin wrapper over lucide-react that maps the design system's
// semantic icon names to Lucide components. Lets the rest of the app reference
// icons by name (e.g. <Icon name="bookmark" />), matching the original mockup.

import {
  Link,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Trash2,
  Download,
  ExternalLink,
  Sun,
  Moon,
  Plus,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Globe,
  LayoutGrid,
  Table,
  AlertTriangle,
  Clock,
  Hash,
  FileText,
  X,
  Check,
  CheckCircle2,
  Bookmark,
  Search,
  Copy,
  ListTree,
  Layers,
  Zap,
  Filter,
  Sparkles,
  Circle,
  Database,
  Mail,
  Send,
  Minus,
  Share2,
  Image,
} from "lucide-react";

const MAP = {
  link: Link,
  "arrow-left": ArrowLeft,
  "arrow-right": ArrowRight,
  "arrow-up-right": ArrowUpRight,
  trash: Trash2,
  download: Download,
  external: ExternalLink,
  sun: Sun,
  moon: Moon,
  plus: Plus,
  "chevron-right": ChevronRight,
  "chevron-left": ChevronLeft,
  "chevron-down": ChevronDown,
  globe: Globe,
  grid: LayoutGrid,
  table: Table,
  clock: Clock,
  hash: Hash,
  file: FileText,
  x: X,
  check: Check,
  "check-circle": CheckCircle2,
  "alert-triangle": AlertTriangle,
  bookmark: Bookmark,
  search: Search,
  copy: Copy,
  "list-tree": ListTree,
  layers: Layers,
  zap: Zap,
  filter: Filter,
  sparkles: Sparkles,
  dot: Circle,
  database: Database,
  mail: Mail,
  send: Send,
  minus: Minus,
  share: Share2,
  image: Image,
};

export default function Icon({ name, size = 20, strokeWidth = 2, className, style }) {
  const Cmp = MAP[name] || Circle;
  return (
    <Cmp
      size={size}
      strokeWidth={strokeWidth}
      className={className}
      style={{ flexShrink: 0, display: "block", ...style }}
      aria-hidden="true"
    />
  );
}
