// Sends the block around the question with it, e.g. the question text when only the options were
// highlighted, or the surrounding text of a screenshot region.
(() => {
  askAiPlugin({
    id: "page-context",
    label: "Text around the question",
    description:
      "Sends the paragraph or form block around your selection (or screenshot) with the question, e.g. the question text when you only highlighted the options.",

    collect({ selectionText, rect }) {
      let node = null;
      if (rect) {
        node = document.elementFromPoint((rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2);
      } else {
        const sel = getSelection();
        if (sel?.rangeCount) node = sel.getRangeAt(0).commonAncestorContainer;
      }
      // Climb until the block clearly holds more than what was selected or under the screenshot's centre.
      const seen = rect ? visibleText(node) : selectionText || "";
      const block = blockAround(node, seen.length + 20);
      if (!block) return null;
      const text = visibleText(block);
      return text ? `Page title: ${document.title}\n\n${text}` : null;
    },
  });
})();
