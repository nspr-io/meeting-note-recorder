import React, { useCallback, useMemo, useState } from 'react';
import styled from '@emotion/styled';
import { PermissionStatus, PermissionType } from '../../shared/types';

const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(17, 24, 39, 0.55);
  z-index: 1500;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
`;

const Dialog = styled.div`
  width: 640px;
  max-width: 100%;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  background: #ffffff;
  border-radius: 18px;
  box-shadow: 0 32px 64px rgba(30, 64, 175, 0.28);
  overflow: hidden;
`;

const Header = styled.div`
  padding: 24px 28px 12px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.24);

  h2 {
    margin: 0;
    font-size: 22px;
    font-weight: 700;
    color: #1f2937;
  }

  p {
    margin: 12px 0 0;
    font-size: 14px;
    line-height: 1.5;
    color: #4b5563;
  }
`;

const Body = styled.div`
  padding: 20px 28px 24px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 24px;
`;

const PermissionList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const PermissionItem = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.3);
  background: rgba(249, 250, 251, 0.9);
  flex-wrap: wrap;
  gap: 12px;
`;

const ItemInfo = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;

  h3 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    color: #1f2937;
  }

  span {
    display: block;
    font-size: 13px;
    color: #6b7280;
  }
`;

const StatusDot = styled.span<{ granted: boolean }>`
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: ${props => (props.granted ? '#22c55e' : '#f97316')};
  box-shadow: ${props => (props.granted ? '0 0 0 4px rgba(34, 197, 94, 0.18)' : '0 0 0 4px rgba(249, 115, 22, 0.18)')};
  flex-shrink: 0;
`;

const PrimaryButton = styled.button<{ disabled?: boolean }>`
  border: none;
  border-radius: 10px;
  padding: 10px 16px;
  font-size: 14px;
  font-weight: 600;
  color: #ffffff;
  background: ${props => (props.disabled ? 'rgba(102, 126, 234, 0.45)' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)')};
  cursor: ${props => (props.disabled ? 'not-allowed' : 'pointer')};
  transition: background 0.2s ease;

  &:hover {
    background: ${props => (props.disabled ? 'rgba(102, 126, 234, 0.45)' : 'linear-gradient(135deg, #5a67d8 0%, #6b46c1 100%)')};
  }
`;

const SecondaryButton = styled.button`
  border-radius: 10px;
  border: 1px solid rgba(148, 163, 184, 0.6);
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 500;
  color: #374151;
  background: #ffffff;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    border-color: #4c51bf;
    color: #4c51bf;
  }
`;

const Footer = styled.div`
  padding: 18px 24px;
  border-top: 1px solid rgba(148, 163, 184, 0.24);
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
`;

const LinkButton = styled.button`
  border: none;
  background: transparent;
  color: #4c51bf;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  text-decoration: underline;
`;

const SectionTitle = styled.h4`
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #1f2937;
`;

const Callout = styled.div`
  border-radius: 12px;
  border: 1px dashed rgba(79, 70, 229, 0.4);
  background: rgba(79, 70, 229, 0.08);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const CopyButton = styled.button`
  align-self: flex-start;
  border-radius: 8px;
  border: 1px solid rgba(102, 126, 234, 0.4);
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 600;
  background: #ffffff;
  color: #4c51bf;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    background: rgba(102, 126, 234, 0.15);
  }
`;

const Hint = styled.p`
  margin: 0;
  font-size: 13px;
  color: #475569;
  line-height: 1.5;
`;

const sdkExecutablePath = '~/Library/Application Support/Recall/desktop_sdk_macos_exe';

interface PermissionOnboardingModalProps {
  open: boolean;
  status: PermissionStatus | null;
  loading: boolean;
  allGranted: boolean;
  onRefresh: () => void;
  onOpenSettings: (permission: PermissionType) => void;
  onRemindLater: () => void;
  onComplete: () => void;
}

const PermissionOnboardingModal: React.FC<PermissionOnboardingModalProps> = ({
  open,
  status,
  loading,
  allGranted,
  onRefresh,
  onOpenSettings,
  onRemindLater,
  onComplete,
}) => {
  const [copied, setCopied] = useState(false);
  const hasStatus = useMemo(() => Boolean(status), [status]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard?.writeText(sdkExecutablePath);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('[PERMISSIONS] Failed to copy SDK path', error);
    }
  }, []);

  if (!open) {
    return null;
  }

  return (
    <Backdrop>
      <Dialog>
        <Header>
          <h2>Enable macOS permissions</h2>
          <p>
            Meeting Note Recorder needs a few macOS permissions so it can capture your meeting window, record audio,
            and control the Recall desktop helper. Use the shortcuts below to open the right System Settings panes and
            grant access to <strong>Meeting Note Recorder</strong> and <strong>desktop_sdk_macos_exe</strong>.
          </p>
        </Header>

        <Body>
          <PermissionList>
            <PermissionItem>
              <ItemInfo>
                <StatusDot granted={!!status?.['screen-capture']} />
                <div>
                  <h3>Screen Recording</h3>
                  <span>{status?.['screen-capture'] ? 'Ready to capture meeting windows' : 'Allow screen recording for both apps'}</span>
                </div>
              </ItemInfo>
              <SecondaryButton onClick={() => onOpenSettings('screen-capture')}>Open System Settings</SecondaryButton>
            </PermissionItem>

            <PermissionItem>
              <ItemInfo>
                <StatusDot granted={!!status?.microphone} />
                <div>
                  <h3>Microphone</h3>
                  <span>{status?.microphone ? 'Microphone access granted' : 'Enable microphone access to record audio'}</span>
                </div>
              </ItemInfo>
              <SecondaryButton onClick={() => onOpenSettings('microphone')}>Open System Settings</SecondaryButton>
            </PermissionItem>

            <PermissionItem>
              <ItemInfo>
                <StatusDot granted={!!status?.accessibility} />
                <div>
                  <h3>Accessibility</h3>
                  <span>{status?.accessibility ? 'Accessibility shortcuts available' : 'Allow control for start/stop automation'}</span>
                </div>
              </ItemInfo>
              <SecondaryButton onClick={() => onOpenSettings('accessibility')}>Open System Settings</SecondaryButton>
            </PermissionItem>
          </PermissionList>

          <Callout>
            <SectionTitle>Don’t forget the Recall helper</SectionTitle>
            <Hint>
              In each permission pane, make sure <strong>desktop_sdk_macos_exe</strong> is also checked. If you don’t see it,
              click the “＋” button, then choose:
            </Hint>
            <CopyButton onClick={handleCopy}>{copied ? 'Copied!' : 'Copy helper path'}</CopyButton>
            <Hint style={{ fontFamily: 'SFMono-Regular, Menlo, monospace', fontSize: '12px', color: '#111827' }}>
              {sdkExecutablePath}
            </Hint>
            <Hint>
              This helper ships with the Recall SDK and handles sniffing for meeting windows. macOS treats it as a separate
              app, so it must be trusted alongside Meeting Note Recorder.
            </Hint>
          </Callout>
        </Body>

        <Footer>
          <LinkButton onClick={onRemindLater}>Remind me later</LinkButton>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <SecondaryButton onClick={onRefresh}>{loading ? 'Checking…' : hasStatus ? 'Refresh status' : 'Check status'}</SecondaryButton>
            <PrimaryButton onClick={onComplete} disabled={!allGranted}>
              {allGranted ? 'Mark complete' : 'Waiting for permissions'}
            </PrimaryButton>
          </div>
        </Footer>
      </Dialog>
    </Backdrop>
  );
};

export default PermissionOnboardingModal;
