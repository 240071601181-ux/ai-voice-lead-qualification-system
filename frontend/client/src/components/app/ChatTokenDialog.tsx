import { useState } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { clearChatToken, getChatToken, setChatToken } from "@/api/chatToken";

/**
 * Development connect dialog for the text-conversation API.
 *
 * The backend conversation API authenticates with a CHAT_JWT Bearer token
 * that has no issuance endpoint by design. The operator pastes a token
 * minted with backend access (see docs/frontend-text-conversation.md); it is
 * stored in sessionStorage for the tab only. No secret lives in source, and
 * nothing here is sent anywhere except as the Authorization header on
 * conversation API calls.
 */
export function ChatTokenDialog({
  open,
  onOpenChange,
  onConnected,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const connected = getChatToken() !== null;

  const save = () => {
    try {
      setChatToken(draft);
      setDraft("");
      setError(null);
      onOpenChange(false);
      onConnected();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the token.");
    }
  };

  const disconnect = () => {
    clearChatToken();
    onOpenChange(false);
    onConnected();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect chat</DialogTitle>
          <DialogDescription>
            Paste a conversation API token minted with backend access. It stays in this
            tab only and is sent solely as the Authorization header.
          </DialogDescription>
        </DialogHeader>
        {connected ? (
          <p className="text-sm text-muted-foreground">
            A token is saved for this tab. Replace it below or disconnect.
          </p>
        ) : null}
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Paste token…"
          rows={3}
          autoComplete="off"
          spellCheck={false}
        />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          {connected ? (
            <Button variant="secondary" onClick={disconnect}>
              Disconnect
            </Button>
          ) : null}
          <Button onClick={save} disabled={!draft.trim()}>
            <KeyRound size={15} /> Save token
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
