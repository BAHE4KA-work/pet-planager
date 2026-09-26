export type ElementType = 'system' | 'class' | 'process' | 'component' | 'object' | 'idea';

export type ElementStatus = 'черновик'; // Future: 'подтверждено' | 'отклонено'

export type RelationType = 'contains' | 'extends' | 'has' | 'instance_of' | 'uses' | 'notes';

export interface ClassField {
  name: string;
  dataType: string;
  description: string;
}

export interface ClassMethod {
  visibility: '+' | '-'; // + public, - private
  signature: string;
  description: string;
}

export interface ObjectFieldValue {
  fieldName: string;
  value: string;
}

export interface PlanElement {
  id: string; // sys_*, cls_*, proc_*, cmp_*, obj_*, idea_*
  type: ElementType;
  title: string;
  fileName: string; // e.g. 'inventory.pgr'
  parent: string; // sys_* or '-'
  description: string;
  status: ElementStatus;
  mvp: boolean;
  customColor?: string; // Optional user marker color override

  // Position on visual canvas
  position: { x: number; y: number };

  // Class-specific ('class')
  extendsId?: string; // cls_* or '-'
  fields?: ClassField[];
  methods?: ClassMethod[];

  // Shared composition ('class' | 'process' | 'component' | 'object') -> 'component'
  components?: string[]; // list of cmp_* IDs ('has' relation)

  // Process & Class interaction ('process' | 'class') -> any element
  uses?: string[]; // list of element IDs ('uses' relation)

  // Process-specific ('process')
  steps?: string[]; // ordered steps

  // Component-specific ('component')
  interfaceItems?: string[]; // public interface items
  internalLogic?: string[]; // private internal logic items

  // Object-specific ('object')
  instanceOf?: string; // cls_* or '-' ('instance_of' relation)
  values?: ObjectFieldValue[]; // overridden field values

  // Idea-specific ('idea')
  notes?: string[]; // list of target element IDs ('notes' relation)
  altTo?: string; // optional id of element this idea was an alternative to
  altReason?: string; // optional reason for rejection
  originIdeaId?: string; // preserved link when transformed from an idea
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relation: RelationType;
  valid: boolean;
  validationMessage?: string;
}

export interface PgrBlockRange {
  elementId: string;
  fileName: string;
  startLine: number;
  endLine: number;
  rawText: string;
}

export interface GitCommit {
  id: string;
  hash: string;
  message: string;
  timestamp: string;
  author: string;
  filesSnapshot: Record<string, string>; // fileName -> .pgr content
  elementsSnapshot: PlanElement[];
}

export interface DiffLine {
  type: 'unchanged' | 'added' | 'removed';
  oldLineNumber?: number;
  newLineNumber?: number;
  content: string;
}

export interface UnitLibraryItem {
  unitId: string;
  category: string;
  savedAt: string;
  element: Omit<PlanElement, 'fileName' | 'position'>;
}

export interface AiProposalCard {
  id: string;
  category: 'balance' | 'new_element' | 'rethink' | 'polish';
  title: string;
  rationale: string;
  targetElementId?: string;
  fileCitation?: string; // e.g., 'inventory.pgr:1-26'
  suggestedElement?: Partial<PlanElement> & {
    id: string;
    type: ElementType;
    title: string;
    parent: string;
    description: string;
  };
}

export interface AiContradiction {
  id: string;
  severity: 'high' | 'medium';
  title: string;
  description: string;
  elementIds: string[];
  fileCitation?: string;
  resolutionHint: string;
  suggestedFix?: {
    targetElementId: string;
    patch: Partial<PlanElement>;
    fixLabel: string;
  };
}

export interface AiInterviewQuestion {
  id: string;
  targetElementId?: string;
  question: string;
  weakSpotContext: string;
  quickOptions: string[];
  userAnswer?: string;
}

export type ThemeMode = 'dark' | 'light' | 'system';

export type PositivePaletteKey = 'emerald' | 'violet' | 'sapphire' | 'teal' | 'amber';
export type NegativePaletteKey = 'crimson' | 'rose' | 'ochre' | 'slate' | 'indigo';

export type LocaleKey = 'ru' | 'en';
