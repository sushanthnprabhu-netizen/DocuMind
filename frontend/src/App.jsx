import "./App.css";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  Bell,
  Bot,
  Check,
  ChevronDown,
  Clock3,
  Command,
  FileText,
  FolderOpen,
  Home,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquareText,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  User,
  X,
} from "lucide-react";

import {
  getHealth,
  askAssistant,
  login as apiLogin,
  register as apiRegister,
  logout as apiLogout,
  getMe,
  getToken,
  setToken,
  listDocuments,
  uploadDocument,
  deleteDocument,
  downloadDocument,
} from "./api";

const INITIAL_ACTIVITY = [
  {
    id: 1,
    title: "Workspace initialized",
    time: "Today",
    icon: Sparkles,
  },
];

function App() {
  const [activePage, setActivePage] = useState("Dashboard");
  const [documents, setDocuments] = useState([]);
  const [activities, setActivities] = useState(INITIAL_ACTIVITY);

  const [search, setSearch] = useState("");
  const [question, setQuestion] = useState("");
  const [aiResponse, setAiResponse] = useState("");

  const [backendOnline, setBackendOnline] = useState(false);
  const [checkingBackend, setCheckingBackend] = useState(false);

  const [selectedFile, setSelectedFile] = useState(null);

  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);

  const [toast, setToast] = useState("");

  const [settings, setSettings] = useState({
    notifications: true,
    autoRefresh: true,
    compactMode: false,
  });

  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({
    name: "",
    email: "",
    password: "",
  });
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  const showToast = (message) => {
    setToast(message);

    setTimeout(() => {
      setToast("");
    }, 2200);
  };

  const addActivity = (title, icon = Activity) => {
    setActivities((current) => [
      {
        id: Date.now(),
        title,
        time: "Just now",
        icon,
      },
      ...current,
    ]);
  };

  const checkBackend = async () => {
    setCheckingBackend(true);

    try {
      const result = await getHealth();

      setBackendOnline(result?.status === "ok");
      showToast("Document service is online");
    } catch {
      setBackendOnline(false);
      showToast("Document service is offline");
    } finally {
      setCheckingBackend(false);
    }
  };

  useEffect(() => {
    checkBackend();

    const existingToken = getToken();
    if (!existingToken) {
      setAuthChecked(true);
      return;
    }

    getMe()
      .then((me) => setUser(me))
      .catch(() => setToken(null))
      .finally(() => setAuthChecked(true));
  }, []);

  const loadDocuments = async () => {
    try {
      const result = await listDocuments();
      setDocuments(result.documents || []);
    } catch {
      showToast("Could not load documents");
    }
  };

  useEffect(() => {
    if (user) {
      loadDocuments();
    }
  }, [user]);

  const handleFileSelect = async (event) => {
    const file = event.target.files?.[0];

    if (!file) return;

    setSelectedFile(file);

    try {
      await uploadDocument(file);
      await loadDocuments();

      addActivity(`${file.name} uploaded`, Upload);

      showToast(`${file.name} added to workspace`);
    } catch (error) {
      showToast(error.message || "Upload failed");
    } finally {
      event.target.value = "";
    }
  };

  const handleAskAI = async () => {
    if (!question.trim()) {
      showToast("Enter a question first");
      return;
    }

    setAiResponse("Processing your question...");

    try {
      const result = await askAssistant(question.trim());

      setAiResponse(result?.data?.answer ?? "No answer received.");

      addActivity("AI Assistant query sent", MessageSquareText);
    } catch (error) {
      setAiResponse(
        error.message ||
          "Unable to reach the document service. Make sure the FastAPI backend is running."
      );

      showToast("AI request failed");
    }
  };

  const handleDeleteDocument = async (id) => {
    const doc = documents.find((item) => item.id === id);

    if (!doc) return;

    try {
      await deleteDocument(id);
      await loadDocuments();

      addActivity(`${doc.name} removed`, Trash2);

      showToast(`${doc.name} removed`);
    } catch (error) {
      showToast(error.message || "Could not delete document");
    }
  };

  const handleOpenDocument = (doc) => {
    showToast(`Opening ${doc.name}`);

    addActivity(`${doc.name} opened`, FolderOpen);
  };

  const handleDownloadDocument = async (doc) => {
    try {
      await downloadDocument(doc.id, doc.name);

      addActivity(`${doc.name} downloaded`, ArrowUpRight);

      showToast("Download started");
    } catch (error) {
      showToast(error.message || "Download failed");
    }
  };

  const filteredDocuments = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) return documents;

    return documents.filter((document) =>
      `${document.name} ${document.type}`
        .toLowerCase()
        .includes(query)
    );
  }, [documents, search]);

  const navigate = (page) => {
    setActivePage(page);
    setShowMobileMenu(false);
    setShowNotifications(false);
    setShowProfile(false);
  };

  const handleQuickUpload = () => {
    document.getElementById("main-file-input")?.click();
  };

  const handleLogout = async () => {
    try {
      await apiLogout();
    } catch {
      // best-effort; clear local session regardless
    }

    setToken(null);
    setUser(null);
    setDocuments([]);
    setShowProfile(false);
    showToast("Signed out of DocuMind");
  };

  const handleAuthSubmit = async (event) => {
    event.preventDefault();
    setAuthError("");
    setAuthLoading(true);

    try {
      const result =
        authMode === "login"
          ? await apiLogin(authForm.email, authForm.password)
          : await apiRegister(
              authForm.email,
              authForm.password,
              authForm.name
            );

      setToken(result.token);
      setUser(result.user);

      showToast(
        authMode === "login"
          ? "Welcome back to DocuMind"
          : "Account created"
      );
    } catch (error) {
      setAuthError(error.message || "Something went wrong");
    } finally {
      setAuthLoading(false);
    }
  };

  if (!authChecked) {
    return (
      <div className="app-shell login-screen">
        <div className="login-card">
          <div className="brand-mark">
            <Sparkles size={20} />
          </div>
          <p>Loading your workspace...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="app-shell login-screen">
        <div className="login-card">
          <div className="brand-mark">
            <Sparkles size={20} />
          </div>

          <h1>
            {authMode === "login" ? "Welcome back" : "Create your account"}
          </h1>

          <p>
            {authMode === "login"
              ? "Sign in to your intelligent document workspace."
              : "Set up your DocuMind workspace."}
          </p>

          <form className="auth-form" onSubmit={handleAuthSubmit}>
            {authMode === "register" && (
              <label className="auth-field">
                <span>Name</span>
                <input
                  type="text"
                  value={authForm.name}
                  onChange={(event) =>
                    setAuthForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="Your name"
                  required
                />
              </label>
            )}

            <label className="auth-field">
              <span>Email</span>
              <input
                type="email"
                value={authForm.email}
                onChange={(event) =>
                  setAuthForm((current) => ({
                    ...current,
                    email: event.target.value,
                  }))
                }
                placeholder="you@example.com"
                required
              />
            </label>

            <label className="auth-field">
              <span>Password</span>
              <input
                type="password"
                value={authForm.password}
                onChange={(event) =>
                  setAuthForm((current) => ({
                    ...current,
                    password: event.target.value,
                  }))
                }
                placeholder="At least 6 characters"
                minLength={6}
                required
              />
            </label>

            {authError && <div className="auth-error">{authError}</div>}

            <button
              className="primary-button"
              type="submit"
              disabled={authLoading}
            >
              <User size={16} />
              {authLoading
                ? "Please wait..."
                : authMode === "login"
                ? "Sign in"
                : "Create account"}
            </button>
          </form>

          <button
            className="text-button auth-switch"
            onClick={() => {
              setAuthMode(authMode === "login" ? "register" : "login");
              setAuthError("");
            }}
          >
            {authMode === "login"
              ? "Need an account? Register"
              : "Already have an account? Sign in"}
          </button>
        </div>

        {toast && <div className="toast">{toast}</div>}
      </div>
    );
  }

  return (
    <div className="app-shell">
      {/* Mobile overlay */}
      {showMobileMenu && (
        <div
          className="mobile-overlay"
          onClick={() => setShowMobileMenu(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`sidebar ${showMobileMenu ? "mobile-open" : ""}`}>
        <div className="sidebar-top">
          <div className="brand">
            <div className="brand-mark">
              <Sparkles size={17} />
            </div>

            <div>
              <div className="brand-name">DocuMind</div>
              <div className="brand-subtitle">Intelligent workspace</div>
              <div className="brand-copyright">© 2026 Sushanth Prabhu</div>
            </div>
          </div>

          <button
            className="sidebar-close"
            onClick={() => setShowMobileMenu(false)}
          >
            <X size={17} />
          </button>
        </div>

        <div className="workspace-card">
          <div className="workspace-icon">
            <ShieldCheck size={16} />
          </div>

          <div>
            <strong>ACA Workspace</strong>
            <span>Personal workspace</span>
          </div>

          <ChevronDown size={14} />
        </div>

        <nav className="sidebar-nav">
          <div className="nav-label">WORKSPACE</div>

          <button
            className={`nav-item ${
              activePage === "Dashboard" ? "active" : ""
            }`}
            onClick={() => navigate("Dashboard")}
          >
            <LayoutDashboard size={16} />
            Dashboard
          </button>

          <button
            className={`nav-item ${
              activePage === "Documents" ? "active" : ""
            }`}
            onClick={() => navigate("Documents")}
          >
            <FileText size={16} />
            Documents
            <span className="nav-count">{documents.length}</span>
          </button>

          <button
            className={`nav-item ${
              activePage === "AI Assistant" ? "active" : ""
            }`}
            onClick={() => navigate("AI Assistant")}
          >
            <Bot size={16} />
            AI Assistant
            <span className="nav-dot" />
          </button>

          <button
            className={`nav-item ${
              activePage === "Activity" ? "active" : ""
            }`}
            onClick={() => navigate("Activity")}
          >
            <Activity size={16} />
            Activity
          </button>

          <div className="nav-label nav-label-settings">
            SYSTEM
          </div>

          <button
            className={`nav-item ${
              activePage === "Settings" ? "active" : ""
            }`}
            onClick={() => navigate("Settings")}
          >
            <Settings size={16} />
            Settings
          </button>
        </nav>

        <div className="sidebar-bottom">
          <div className="storage-header">
            <span>Workspace storage</span>
            <span>24%</span>
          </div>

          <div className="storage-bar">
            <div />
          </div>

          <span className="storage-text">
            2.4 GB of 10 GB used
          </span>
        

          <div className="user-card">
            <div className="avatar">{user?.name?.[0]?.toUpperCase() || "U"}</div>

            <div className="user-details">
              <strong>{user?.name || "Account"}</strong>
              <span>{user?.email || "Signed in"}</span>
            </div>

            <button
              className="icon-button small"
              onClick={() => setShowProfile((value) => !value)}
            >
              <MoreHorizontal size={16} />
            </button>
          </div>
        </div>
        
      </aside>

      {/* Main */}
      <main className="main-content">
        {/* Topbar */}
        <header className="topbar">
          <button
            className="mobile-menu-button icon-button"
            onClick={() => setShowMobileMenu(true)}
          >
            <Menu size={18} />
          </button>

          <div className="breadcrumbs">
            <Home size={14} />
            <span>/</span>
            <strong>{activePage}</strong>
          </div>

          <div className="topbar-actions">
            <div className="search-box">
              <Search size={15} />

              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search documents..."
              />

              <span className="shortcut">
                <Command size={10} /> K
              </span>
            </div>

            <button
              className="icon-button"
              onClick={() =>
                setShowNotifications((value) => !value)
              }
            >
              <Bell size={17} />
              <span className="notification-dot" />
            </button>

            <button
              className="profile-button"
              onClick={() =>
                setShowProfile((value) => !value)
              }
            >
              <span className="avatar small-avatar">
                {user?.name?.[0]?.toUpperCase() || "U"}
              </span>
              <ChevronDown size={13} />
            </button>
          </div>

          {/* Notifications */}
          {showNotifications && (
            <div className="dropdown notification-panel">
              <div className="dropdown-title">
                <strong>Notifications</strong>
                <span>3 new</span>
              </div>

              <div className="notification-item">
                <div className="notification-icon">
                  <Upload size={14} />
                </div>
                <div>
                  <strong>Document uploaded</strong>
                  <span>Research Paper.pdf</span>
                </div>
              </div>

              <div className="notification-item">
                <div className="notification-icon">
                  <Check size={14} />
                </div>
                <div>
                  <strong>Backend connected</strong>
                  <span>Document service is online</span>
                </div>
              </div>

              <button
                className="dropdown-action"
                onClick={() => {
                  setShowNotifications(false);
                  navigate("Activity");
                }}
              >
                View all activity
              </button>
            </div>
          )}

          {/* Profile */}
          {showProfile && (
            <div className="dropdown profile-panel">
              <div className="profile-heading">
                <div className="avatar">{user?.name?.[0]?.toUpperCase() || "U"}</div>

                <div>
                  <strong>{user?.name || "Account"}</strong>
                  <span>{user?.email || "Signed in"}</span>
                </div>
              </div>

              <button
                className="dropdown-action"
                onClick={() => navigate("Settings")}
              >
                <Settings size={14} />
                Settings
              </button>

              <button
                className="dropdown-action danger"
                onClick={handleLogout}
              >
                <LogOut size={14} />
                Sign out
              </button>
            </div>
          )}
        </header>

        {/* Dashboard */}
        {activePage === "Dashboard" && (
          <section className="page">
            <div className="hero">
              <div>
                <div className="eyebrow">
                  <span className="status-pulse" />
                  WORKSPACE ONLINE
                </div>

                <h1>
                  Your documents,
                  <br />
                  <span>understood.</span>
                </h1>

                <p>
                  Organize, explore and interact with your
                  documents from one intelligent workspace.
                </p>

                <div className="hero-actions">
                  <button
                    className="primary-button"
                    onClick={handleQuickUpload}
                  >
                    <Upload size={16} />
                    Upload document
                  </button>

                  <button
                    className="secondary-button"
                    onClick={() => navigate("AI Assistant")}
                  >
                    <Bot size={16} />
                    Ask AI
                  </button>
                </div>

                <input
                  id="main-file-input"
                  type="file"
                  accept=".pdf,.doc,.docx,.txt"
                  onChange={handleFileSelect}
                  hidden
                />
              </div>

              <div className="hero-orb">
                <div className="orb-inner">
                  <Sparkles size={28} />
                </div>
              </div>
            </div>

            {/* Stats */}
            <div className="stats-grid">
              <StatCard
                icon={FileText}
                label="Total documents"
                value={documents.length}
                detail="+1 this session"
              />

              <StatCard
                icon={Clock3}
                label="Recent activity"
                value={activities.length}
                detail="Live workspace"
              />

              <StatCard
                icon={Bot}
                label="AI queries"
                value={
                  activities.filter((item) =>
                    item.title.includes("AI Assistant")
                  ).length
                }
                detail="This session"
              />

              <StatCard
                icon={ShieldCheck}
                label="Service status"
                value={backendOnline ? "Online" : "Offline"}
                detail={
                  backendOnline
                    ? "FastAPI connected"
                    : "Check backend"
                }
                status={backendOnline}
              />
            </div>

            <div className="content-grid">
              {/* Documents */}
              <div className="panel documents-panel">
                <div className="panel-header">
                  <div>
                    <span className="panel-kicker">LIBRARY</span>
                    <h2>Recent documents</h2>
                  </div>

                  <button
                    className="text-button"
                    onClick={() => navigate("Documents")}
                  >
                    View all
                    <ArrowUpRight size={13} />
                  </button>
                </div>

                <div className="document-list">
                  {filteredDocuments.length === 0 ? (
                    <EmptyState
                      icon={Search}
                      title="No documents found"
                      text="Try another search term."
                    />
                  ) : (
                    filteredDocuments.slice(0, 5).map((document) => (
                      <DocumentRow
                        key={document.id}
                        document={document}
                        onOpen={handleOpenDocument}
                        onDownload={handleDownloadDocument}
                        onDelete={handleDeleteDocument}
                      />
                    ))
                  )}
                </div>
              </div>

              {/* AI */}
              <div className="panel ai-panel">
                <div className="ai-glow" />

                <div className="panel-header ai-header">
                  <div className="ai-title">
                    <div className="ai-icon">
                      <Bot size={18} />
                    </div>

                    <div>
                      <span className="panel-kicker">
                        INTELLIGENCE
                      </span>
                      <h2>AI Assistant</h2>
                    </div>
                  </div>

                  <span className="live-badge">
                    <span />
                    LIVE
                  </span>
                </div>

                <div className="ai-content">
                  <p>
                    Ask questions and test your document
                    intelligence workflow.
                  </p>

                  <div className="suggestion-list">
                    <button
                      onClick={() => {
                        setQuestion(
                          "What documents are currently available?"
                        );
                        navigate("AI Assistant");
                      }}
                    >
                      <MessageSquareText size={14} />
                      Summarize my workspace
                    </button>

                    <button
                      onClick={() => {
                        setQuestion(
                          "What is the latest document?"
                        );
                        navigate("AI Assistant");
                      }}
                    >
                      <FileText size={14} />
                      Find recent documents
                    </button>
                  </div>

                  <div className="ai-input">
                    <MessageSquareText size={16} />

                    <input
                      value={question}
                      onChange={(event) =>
                        setQuestion(event.target.value)
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          handleAskAI();
                        }
                      }}
                      placeholder="Ask anything about your documents..."
                    />

                    <button onClick={handleAskAI}>
                      Ask
                    </button>
                  </div>

                  {aiResponse && (
                    <div className="ai-response">
                      {aiResponse}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Activity */}
            <div className="panel activity-panel">
              <div className="panel-header">
                <div>
                  <span className="panel-kicker">TIMELINE</span>
                  <h2>Recent activity</h2>
                </div>

                <button
                  className="icon-button"
                  onClick={() => navigate("Activity")}
                >
                  <ArrowUpRight size={15} />
                </button>
              </div>

              <div className="activity-list">
                {activities.slice(0, 4).map((item) => {
                  const Icon = item.icon;

                  return (
                    <div className="activity-row" key={item.id}>
                      <div className="activity-icon">
                        <Icon size={14} />
                      </div>

                      <div className="activity-info">
                        <strong>{item.title}</strong>
                        <span>{item.time}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {/* Documents */}
        {activePage === "Documents" && (
          <section className="page">
            <PageHeader
              eyebrow="LIBRARY"
              title="Documents"
              description="Manage every document in your workspace."
              action={
                <button
                  className="primary-button"
                  onClick={handleQuickUpload}
                >
                  <Plus size={16} />
                  Add document
                </button>
              }
            />

            <div className="panel full-panel">
              <div className="documents-toolbar">
                <div className="inline-search">
                  <Search size={15} />

                  <input
                    value={search}
                    onChange={(event) =>
                      setSearch(event.target.value)
                    }
                    placeholder="Filter documents..."
                  />
                </div>

                <span className="result-count">
                  {filteredDocuments.length} documents
                </span>
              </div>

              <div className="document-list large">
                {filteredDocuments.length === 0 ? (
                  <EmptyState
                    icon={FolderOpen}
                    title="Your library is empty"
                    text="Upload a document to get started."
                  />
                ) : (
                  filteredDocuments.map((document) => (
                    <DocumentRow
                      key={document.id}
                      document={document}
                      onOpen={handleOpenDocument}
                      onDownload={handleDownloadDocument}
                      onDelete={handleDeleteDocument}
                    />
                  ))
                )}
              </div>
            </div>

            <input
              id="main-file-input"
              type="file"
              accept=".pdf,.doc,.docx,.txt"
              onChange={handleFileSelect}
              hidden
            />
          </section>
        )}

        {/* AI Assistant */}
        {activePage === "AI Assistant" && (
          <section className="page">
            <PageHeader
              eyebrow="INTELLIGENCE"
              title="AI Assistant"
              description="Interact with the document service through a simple query interface."
            />

            <div className="panel assistant-page">
              <div className="assistant-icon">
                <Bot size={30} />
              </div>

              <h2>Ask your workspace</h2>

              <p>
                Send a question to the connected backend and
                inspect the response.
              </p>

              <div className="large-ai-input">
                <MessageSquareText size={18} />

                <input
                  value={question}
                  onChange={(event) =>
                    setQuestion(event.target.value)
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      handleAskAI();
                    }
                  }}
                  placeholder="Type your question..."
                />

                <button
                  className="primary-button"
                  onClick={handleAskAI}
                >
                  Ask AI
                </button>
              </div>

              {aiResponse && (
                <div className="assistant-result">
                  <div className="result-label">
                    AI GENERATED ANSWER
                  </div>

                  <p className="assistant-answer">
                    {aiResponse
                      .replace(/\n\* /g, "\n• ")
                      .replace(/^\* /, "• ")}
                  </p>
                </div>
              )}

              <div className="assistant-suggestions">
                <button
                  onClick={() =>
                    setQuestion("Give me a summary of my workspace")
                  }
                >
                  Give me a workspace summary
                </button>

                <button
                  onClick={() =>
                    setQuestion(
                      "Which document was uploaded most recently?"
                    )
                  }
                >
                  Find my latest document
                </button>

                <button
                  onClick={() =>
                    setQuestion(
                      "How many documents are currently available?"
                    )
                  }
                >
                  Count my documents
                </button>
              </div>
            </div>
          </section>
        )}

        {/* Activity */}
        {activePage === "Activity" && (
          <section className="page">
            <PageHeader
              eyebrow="TIMELINE"
              title="Activity"
              description="Everything that happened in this workspace session."
              action={
                <button
                  className="secondary-button"
                  onClick={() => {
                    setActivities([]);
                    showToast("Activity cleared");
                  }}
                >
                  <Trash2 size={15} />
                  Clear activity
                </button>
              }
            />

            <div className="panel full-panel">
              <div className="activity-page-list">
                {activities.length === 0 ? (
                  <EmptyState
                    icon={Activity}
                    title="No activity"
                    text="Workspace activity will appear here."
                  />
                ) : (
                  activities.map((item) => {
                    const Icon = item.icon;

                    return (
                      <div
                        className="activity-page-row"
                        key={item.id}
                      >
                        <div className="activity-icon">
                          <Icon size={15} />
                        </div>

                        <div>
                          <strong>{item.title}</strong>
                          <span>{item.time}</span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </section>
        )}

        {/* Settings */}
        {activePage === "Settings" && (
          <section className="page">
            <PageHeader
              eyebrow="SYSTEM"
              title="Settings"
              description="Configure your DocuMind workspace."
            />

            <div className="settings-grid">
              <div className="panel settings-panel">
                <div className="setting-heading">
                  <div className="setting-icon">
                    <Bell size={17} />
                  </div>

                  <div>
                    <h3>Notifications</h3>
                    <p>
                      Receive workspace activity notifications.
                    </p>
                  </div>

                  <Toggle
                    enabled={settings.notifications}
                    onChange={() =>
                      setSettings((current) => ({
                        ...current,
                        notifications:
                          !current.notifications,
                      }))
                    }
                  />
                </div>

                <div className="setting-heading">
                  <div className="setting-icon">
                    <RefreshCw size={17} />
                  </div>

                  <div>
                    <h3>Auto refresh</h3>
                    <p>
                      Automatically check backend availability.
                    </p>
                  </div>

                  <Toggle
                    enabled={settings.autoRefresh}
                    onChange={() =>
                      setSettings((current) => ({
                        ...current,
                        autoRefresh: !current.autoRefresh,
                      }))
                    }
                  />
                </div>

                <div className="setting-heading">
                  <div className="setting-icon">
                    <LayoutDashboard size={17} />
                  </div>

                  <div>
                    <h3>Compact mode</h3>
                    <p>
                      Reduce spacing across document lists.
                    </p>
                  </div>

                  <Toggle
                    enabled={settings.compactMode}
                    onChange={() =>
                      setSettings((current) => ({
                        ...current,
                        compactMode: !current.compactMode,
                      }))
                    }
                  />
                </div>
              </div>

              <div className="panel settings-panel">
                <div className="panel-header">
                  <div>
                    <span className="panel-kicker">
                      CONNECTION
                    </span>
                    <h2>Backend service</h2>
                  </div>

                  <button
                    className="icon-button"
                    onClick={checkBackend}
                    disabled={checkingBackend}
                  >
                    <RefreshCw
                      size={15}
                      className={
                        checkingBackend ? "spin" : ""
                      }
                    />
                  </button>
                </div>

                <div className="connection-status">
                  <div
                    className={`connection-indicator ${
                      backendOnline ? "online" : "offline"
                    }`}
                  />

                  <div>
                    <strong>
                      {backendOnline
                        ? "Connected"
                        : "Disconnected"}
                    </strong>

                    <span>
                      FastAPI document service
                    </span>
                  </div>
                </div>

                <div className="connection-url">
                  <span>API endpoint</span>
                  <code>http://localhost:8000</code>
                </div>
              </div>
            </div>
          </section>
        )}
      </main>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  detail,
  status,
}) {
  return (
    <div className="stat-card">
      <div className="stat-top">
        <div className="stat-icon">
          <Icon size={16} />
        </div>

        {status !== undefined && (
          <span
            className={`stat-status ${
              status ? "online" : "offline"
            }`}
          >
            {status ? "●" : "●"}
          </span>
        )}
      </div>

      <span className="stat-label">{label}</span>

      <strong className="stat-value">{value}</strong>

      <span className="stat-detail">{detail}</span>
    </div>
  );
}

function DocumentRow({
  document,
  onOpen,
  onDownload,
  onDelete,
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="document-row">
      <div className="document-file-icon">
        <FileText size={17} />
      </div>

      <div className="document-info">
        <strong>{document.name}</strong>

        <span>
          {document.type} · {document.size}
        </span>
      </div>

      <span className="document-updated">
        {document.uploaded_at
          ? new Date(document.uploaded_at).toLocaleString()
          : ""}
      </span>

      <button
        className="icon-button document-open"
        onClick={() => onOpen(document)}
      >
        <FolderOpen size={15} />
      </button>

      <div className="document-menu-wrapper">
        <button
          className="icon-button"
          onClick={() => setMenuOpen((value) => !value)}
        >
          <MoreHorizontal size={15} />
        </button>

        {menuOpen && (
          <div className="document-menu">
            <button
              onClick={() => {
                setMenuOpen(false);
                onOpen(document);
              }}
            >
              <FolderOpen size={13} />
              Open
            </button>

            <button
              onClick={() => {
                setMenuOpen(false);
                onDownload(document);
              }}
            >
              <ArrowUpRight size={13} />
              Download
            </button>

            <button
              className="danger"
              onClick={() => {
                setMenuOpen(false);
                onDelete(document.id);
              }}
            >
              <Trash2 size={13} />
              Remove
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function PageHeader({
  eyebrow,
  title,
  description,
  action,
}) {
  return (
    <div className="page-header">
      <div>
        <span className="panel-kicker">{eyebrow}</span>

        <h1>{title}</h1>

        <p>{description}</p>
      </div>

      {action && <div>{action}</div>}
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  text,
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Icon size={19} />
      </div>

      <strong>{title}</strong>

      <span>{text}</span>
    </div>
  );
}

function Toggle({ enabled, onChange }) {
  return (
    <button
      className={`toggle ${enabled ? "enabled" : ""}`}
      onClick={onChange}
      aria-label="Toggle setting"
    >
      <span />
    </button>
  );
}

export default App;