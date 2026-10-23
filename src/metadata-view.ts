import { RangeSetBuilder, StateField, EditorState } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView } from '@codemirror/view';
import { editorLivePreviewField } from 'obsidian';
import { scanTables } from './markdown';
function hiddenComments(state: EditorState): DecorationSet {
  if (!state.field(editorLivePreviewField, false)) return Decoration.none;
  const ranges = new RangeSetBuilder<Decoration>();
  for (const table of scanTables(state.doc.toString()))
    if (table.metadataFrom !== undefined && table.metadataTo !== undefined)
      ranges.add(
        table.metadataFrom,
        table.metadataTo,
        Decoration.replace({ block: true, inclusive: true }),
      );
  return ranges.finish();
}
// Hide only our extension information. Native table widgets and source mode stay intact.
export const metadataField = StateField.define<DecorationSet>({
  create: hiddenComments,
  update: (_value, transaction) => hiddenComments(transaction.state),
  provide: (field) => [
    EditorView.decorations.from(field),
    EditorView.atomicRanges.of((view) => view.state.field(field)),
  ],
});
