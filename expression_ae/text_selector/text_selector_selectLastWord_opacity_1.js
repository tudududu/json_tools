// text_selector_selectLastWord.js
// Expression Selector -> Amount
// Accent layer selector: selects ONLY the last word on the LAST line.
// Word split is space-delimited; punctuation remains part of the selected word.

var s = text.sourceText.toString();

// Normalize line endings and remove trailing whitespace so last-word detection is stable.
s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
s = s.replace(/\s+$/, "");

if (s.length === 0) {
  0;
} else {
  // Last line starts after last newline (or at 0 when single-line).
  var lastBreak = s.lastIndexOf("\n");
  var lineStart0 = lastBreak + 1;

  var lastLine = s.substring(lineStart0);
  var lastSpaceInLine = lastLine.lastIndexOf(" ");

  // 1-based start index of last word on last line.
  var start = (lastSpaceInLine === -1) ? (lineStart0 + 1) : (lineStart0 + lastSpaceInLine + 2);

  (textIndex >= start) ? 100 : 0;
}