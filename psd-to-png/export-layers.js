const PSD = require("psd");
const fs = require("fs");
const path = require("path");

const psdPath = process.argv[2];
if (!psdPath) {
  console.error("Usage: node export-layers.js <path-to-psd-file>");
  process.exit(1);
}

const outputDir = process.argv[3] || path.join(path.dirname(psdPath), "exported-layers");

async function exportLayers() {
  const psd = await PSD.open(psdPath);
  const tree = psd.tree();

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  let count = 0;

  function processNode(node, prefix = "") {
    // Skip the root node itself
    if (node.type === "group" && node.children()) {
      for (const child of node.children()) {
        processNode(child, prefix);
      }
      return;
    }

    if (node.type === "layer" && node.layer && node.layer.visible) {
      const name = sanitize(node.name);
      const filename = prefix ? `${prefix}__${name}.png` : `${name}.png`;
      const outputPath = path.join(outputDir, filename);

      try {
        node.saveAsPng(outputPath);
        count++;
        console.log(`Exported: ${filename}`);
      } catch (err) {
        console.warn(`Skipped "${node.name}": ${err.message}`);
      }
    }

    // If this is a group, recurse into children
    if (node.children && node.children()) {
      for (const child of node.children()) {
        const groupPrefix = prefix ? `${prefix}__${sanitize(node.name)}` : sanitize(node.name);
        processNode(child, groupPrefix);
      }
    }
  }

  processNode(tree);
  console.log(`\nDone! Exported ${count} layers to: ${outputDir}`);
}

function sanitize(name) {
  return name.replace(/[<>:"/\\|?*]/g, "_").replace(/\s+/g, "_");
}

exportLayers().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
