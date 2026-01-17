// Expression — select only the last word

// “Faux Bold” via Stroke Width
// This thickens only the last word by adding a same-color stroke.

// Steps
// Create your Text Layer.
// Add Animator > Stroke Width.
// Set Stroke Color.
// Set Stroke Width to something small, e.g. 1–3 px (tune for your font/size).
// With the same Animator selected, choose Add > Selector > Expression.

// Notes
// Make sure the Selector is Based On: Characters (default), and Mode: Add.
// If you don’t see thickening, ensure the Animator has Stroke Color and Stroke Width added (the layer doesn’t need a stroke set in the Character panel—Animator overrides are enough).
// You can combine this with a Fill Color property in the same Animator to recolor only the last word.

// Expression Selector → Amount:

// Select everything but the last word (space-delimited). textIndex is 1-based.
var s = text.sourceText.toString();

// Trim trailing spaces so we don't treat them as an empty "last word"
s = s.replace(/\s+$/, '');

// If empty, select nothing
if (s.length === 0) {0;}
else {
  var lastSpace = s.lastIndexOf(" ");
  // First character index (1-based) of the last word
  var start = (lastSpace === -1) ? 1 : lastSpace + 2;

  // Apply to all characters *before* the last word
  (textIndex < start) ? 100 : 0;
}




// Expression Selector → Amount
// Targets only the last word on the last line (space-delimited).
// Works for multi-line text and ignores trailing whitespace.

var s = text.sourceText.toString();

// Trim trailing whitespace (spaces/tabs/newlines) so the "last word" is accurate
s = s.replace(/\s+$/, '');

if (s.length === 0) {0;} else {
  // Find the last line break (\r for AE line breaks, \n just in case)
  var lastCR = s.lastIndexOf('\r');
  var lastLF = s.lastIndexOf('\n');
  var lb = Math.max(lastCR, lastLF); // -1 if there is no line break

  // Start index (0-based) of the last line
  var lineStart0 = lb + 1;

  // Substring of the last line
  var lastLine = s.substring(lineStart0);

  // Find the last space in the last line (word delimiter)
  var lastSpaceInLine = lastLine.lastIndexOf(' ');

  // 0-based start index of the last word
  var lastWordStart0 = (lastSpaceInLine === -1) ? lineStart0 : (lineStart0 + lastSpaceInLine + 1);

  // Convert to 1-based index to compare with textIndex
  var start = lastWordStart0; // + 1; disabled, because it selects the first char of the last word too

  // Select from the start of the last word to the end
  (textIndex >= start) ? 100 : 0;
}



// Inverse (everything except the last word on the last line)
// If you want to apply the effect to all text except the last word on the last line, just flip the comparison:
(textIndex < start) ? 100 : 0;





// Select last word (space-delimited). textIndex is 1-based.
var s = text.sourceText.toString();

// Trim trailing spaces to avoid selecting empty "last word"
s = s.replace(/\s+$/,''); 

// If empty, select nothing
if (s.length === 0) { 0; } else {
  var lastSpace = s.lastIndexOf(" ");
  // If no space, we consider the whole string the "last word"
  var start = (lastSpace === -1) ? 1 : lastSpace + 2; 
  (textIndex >= start) ? 100 : 0;
}