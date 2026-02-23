const docUrl = document.getElementById("docUrl");
const loadBtn = document.getElementById("loadBtn");
const status = document.getElementById("status");
const chat = document.getElementById("chat");
const question = document.getElementById("question");
const askBtn = document.getElementById("askBtn");
const errorEl = document.getElementById("error");

function setError(msg) {
  errorEl.textContent = msg || "";
}

function setStatus(text) {
  status.textContent = text;
}

function escapeHtml(s) {
  if (typeof s !== "string") return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Turn markdown code blocks (``` or ```bash etc.) into <pre><code> boxes. */
function formatMessageWithCodeBlocks(text) {
  if (!text) return "";
  const parts = [];
  let lastIndex = 0;
  const re = /```(\w*)\n?([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    parts.push({ type: "text", value: text.slice(lastIndex, m.index) });
    parts.push({ type: "code", lang: m[1], value: m[2] });
    lastIndex = re.lastIndex;
  }
  parts.push({ type: "text", value: text.slice(lastIndex) });
  let html = "";
  for (const p of parts) {
    if (p.type === "text") {
      html += escapeHtml(p.value).replace(/\n/g, "<br>");
    } else {
      const langClass = p.lang ? ` language-${escapeHtml(p.lang)}` : "";
      html += `<pre class="chat-code"><code class="${langClass}">${escapeHtml(p.value.trim())}</code></pre>`;
    }
  }
  return html;
}

function addMessage(role, content, isStreaming = false) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  const roleEl = document.createElement("div");
  roleEl.className = "role";
  roleEl.textContent = role === "user" ? "You" : "DocChat";
  const contentEl = document.createElement("div");
  contentEl.className = "content";
  if (role === "assistant" && content) {
    contentEl.innerHTML = formatMessageWithCodeBlocks(content);
  } else {
    contentEl.textContent = content;
  }
  if (isStreaming) contentEl.dataset.streaming = "1";
  div.appendChild(roleEl);
  div.appendChild(contentEl);
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
  return contentEl;
}

function updateStreamingEl(contentEl, fullText) {
  contentEl.innerHTML = formatMessageWithCodeBlocks(fullText);
  chat.scrollTop = chat.scrollHeight;
}

loadBtn.addEventListener("click", async () => {
  const url = docUrl.value.trim();
  if (!url) {
    setError("Enter a URL.");
    return;
  }
  setError("");
  loadBtn.disabled = true;
  try {
    const res = await fetch("/api/set-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      credentials: "include",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || `Error ${res.status}`);
      return;
    }
    setStatus(`Loaded: ${data.url || url} (${data.chunks ?? 0} chunks). You can ask questions.`);
    askBtn.disabled = false;
    chat.innerHTML = "";
  } finally {
    loadBtn.disabled = false;
  }
});

askBtn.addEventListener("click", async () => {
  const message = question.value.trim();
  if (!message) return;
  setError("");
  askBtn.disabled = true;
  question.value = "";

  addMessage("user", message);
  const contentEl = addMessage("assistant", "", true);

  try {
    const res = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
      credentials: "include",
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      contentEl.textContent = data.error || `Error ${res.status}`;
      contentEl.dataset.streaming = "";
      askBtn.disabled = false;
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let streamedText = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.response != null) {
              streamedText += data.response;
              updateStreamingEl(contentEl, streamedText);
            }
          } catch (_) {}
        }
      }
    }
    if (buffer) {
      const line = buffer.trim();
      if (line.startsWith("data: ")) {
        try {
          const data = JSON.parse(line.slice(6));
          if (data.response != null) {
            streamedText += data.response;
            updateStreamingEl(contentEl, streamedText);
          }
        } catch (_) {}
      }
    }
  } catch (e) {
    contentEl.textContent = e instanceof Error ? e.message : "Request failed";
    setError("Network or stream error.");
  } finally {
    contentEl.dataset.streaming = "";
    askBtn.disabled = false;
  }
});

question.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    askBtn.click();
  }
});
