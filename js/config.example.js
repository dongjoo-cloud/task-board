/* Copy to js/config.js for local testing, or rely on Pages deploy injection. */
window.BOARD_CONFIG = {
  owner: "dongjoo-cloud",
  repo: "task-board",
  branch: "main",
  mode: "dispatch", // "dispatch" (preferred) | "contents"
  token: "" // fine-grained PAT with Contents: write on task-board only
};
