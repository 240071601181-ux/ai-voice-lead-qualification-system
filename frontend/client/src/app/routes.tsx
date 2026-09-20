import { Redirect, Route, Switch } from "wouter";
import { AppLayout, ToastProvider } from "@/layouts/AppLayout";
import { AuthLayout } from "@/layouts/AuthLayout";
import { RequireAuth } from "@/app/guards";
import NotFound from "@/pages/NotFound";
import LoginPage from "@/pages/auth/LoginPage";
import SignupPage from "@/pages/auth/SignupPage";
import ForgotPasswordPage from "@/pages/auth/ForgotPasswordPage";
import ResetPasswordPage from "@/pages/auth/ResetPasswordPage";
import VerifyEmailPage from "@/pages/auth/VerifyEmailPage";
import AccountCreatedPage from "@/pages/auth/AccountCreatedPage";
import DashboardPage from "@/pages/dashboard/DashboardPage";
import LeadsPage from "@/pages/leads/LeadsPage";
import LeadDetailPage from "@/pages/leads/LeadDetailPage";
import LeadEditPage from "@/pages/leads/LeadEditPage";
import LeadCreatePage from "@/pages/leads/LeadCreatePage";
import ConversationsPage from "@/pages/conversations/ConversationsPage";
import ConversationDetailPage from "@/pages/conversations/ConversationDetailPage";
import QualificationsPage from "@/pages/qualifications/QualificationsPage";
import QualificationDetailPage from "@/pages/qualifications/QualificationDetailPage";
import FollowupsPage from "@/pages/followups/FollowupsPage";
import FollowupDetailPage from "@/pages/followups/FollowupDetailPage";
import AiAgentPage from "@/pages/ai-agent/AiAgentPage";
import KnowledgePage from "@/pages/knowledge/KnowledgePage";
import KnowledgeSearchPage from "@/pages/knowledge/KnowledgeSearchPage";
import KnowledgeIngestPage from "@/pages/knowledge/KnowledgeIngestPage";
import CrmPage from "@/pages/integrations/CrmPage";
import WhatsappPage from "@/pages/integrations/WhatsappPage";
import CalendarPage from "@/pages/integrations/CalendarPage";
import MeetingDetailsPage from "@/pages/integrations/MeetingDetailsPage";
import AutomationPage from "@/pages/integrations/AutomationPage";
import ActivityPage from "@/pages/system/ActivityPage";
import NotificationsPage from "@/pages/system/NotificationsPage";
import ProfilePage from "@/pages/system/ProfilePage";
import SettingsPage from "@/pages/system/SettingsPage";
import HelpPage from "@/pages/system/HelpPage";
import CustomerChatPage from "@/pages/chat/CustomerChatPage";

/**
 * Phase 14C-2 – full route table.
 *
 * Auth routes render inside AuthLayout (no sidebar). Every other route
 * renders inside RequireAuth + AppLayout (sidebar, topbar, toast).
 * Detail routes read :id via useParams in their page component.
 */
function appRoute(path: string, metaKey: string, page: React.ReactNode) {
  return (
    <Route path={path}>
      <RequireAuth>
        <ToastProvider>
          <AppLayout path={metaKey}>{page}</AppLayout>
        </ToastProvider>
      </RequireAuth>
    </Route>
  );
}

function authRoute(path: string, page: React.ReactNode) {
  return (
    <Route path={path}>
      <AuthLayout>{page}</AuthLayout>
    </Route>
  );
}

export function Router() {
  return (
    <Switch>
      {authRoute("/login", <LoginPage />)}
      {authRoute("/signup", <SignupPage />)}
      {authRoute("/forgot-password", <ForgotPasswordPage />)}
      {authRoute("/reset-password", <ResetPasswordPage />)}
      {authRoute("/verify-email", <VerifyEmailPage />)}
      {authRoute("/account-created", <AccountCreatedPage />)}

      {/* Phase 20 — external customer chat. Public routes with their own
          minimal shell: never the admin AppLayout, never RequireAuth. */}
      <Route path="/chat/:token">
        <CustomerChatPage />
      </Route>
      <Route path="/chat">
        <CustomerChatPage />
      </Route>

      {appRoute("/", "/dashboard", <DashboardPage />)}
      {appRoute("/dashboard", "/dashboard", <DashboardPage />)}

      {appRoute("/leads", "/leads", <LeadsPage />)}
      {/* Phase 14C-4: /leads/new must precede /leads/:id so "new" isn't parsed as an id. */}
      {appRoute("/leads/new", "/leads", <LeadCreatePage />)}
      {appRoute("/leads/:id/edit", "/leads", <LeadEditPage />)}
      {appRoute("/leads/:id", "/leads", <LeadDetailPage />)}

      {/* Phase 14 — legacy voice Calls retired: old /calls URLs redirect
          to Conversations (text is the primary interaction model). */}
      <Route path="/calls/:id">
        <Redirect to="/conversations" />
      </Route>
      <Route path="/calls">
        <Redirect to="/conversations" />
      </Route>

      {appRoute("/conversations", "/conversations", <ConversationsPage />)}
      {appRoute("/conversations/:id", "/conversations", <ConversationDetailPage />)}

      {appRoute("/qualifications", "/qualifications", <QualificationsPage />)}
      {appRoute("/qualifications/:id", "/qualifications", <QualificationDetailPage />)}

      {appRoute("/followups", "/followups", <FollowupsPage />)}
      {/* Phase 14C-7: detail for genuine backend follow-up ids (GET /api/v1/followups/:id). */}
      {appRoute("/followups/:id", "/followups", <FollowupDetailPage />)}

      {appRoute("/ai-agent", "/ai-agent", <AiAgentPage />)}

      {appRoute("/knowledge", "/knowledge", <KnowledgePage />)}
      {appRoute("/knowledge/search", "/knowledge", <KnowledgeSearchPage />)}
      {appRoute("/knowledge/ingest", "/knowledge", <KnowledgeIngestPage />)}

      {appRoute("/crm", "/crm", <CrmPage />)}
      {appRoute("/whatsapp", "/whatsapp", <WhatsappPage />)}
      {appRoute("/calendar", "/calendar", <CalendarPage />)}
      {appRoute("/calendar/:id", "/calendar", <MeetingDetailsPage />)}
      {appRoute("/automation", "/automation", <AutomationPage />)}

      {appRoute("/activity", "/activity", <ActivityPage />)}
      {appRoute("/notifications", "/notifications", <NotificationsPage />)}
      {appRoute("/profile", "/profile", <ProfilePage />)}
      {appRoute("/settings", "/settings", <SettingsPage />)}
      {appRoute("/help", "/help", <HelpPage />)}

      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}
