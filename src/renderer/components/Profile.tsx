import React, { useState, useEffect, useRef } from 'react';
import styled from '@emotion/styled';
import { UserProfile } from '../../shared/types';
import {
  MDXEditor,
  headingsPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  toolbarPlugin,
  BoldItalicUnderlineToggles,
  ListsToggle,
} from '@mdxeditor/editor';
import '@mdxeditor/editor/style.css';

const ProfileContainer = styled.div`
  padding: 24px;
  overflow-y: auto;
  height: 100%;
`;

const Section = styled.div`
  margin-bottom: 32px;
`;

const SectionTitle = styled.h2`
  font-size: 16px;
  font-weight: 600;
  color: #1d1d1f;
  margin-bottom: 16px;
`;

const FormGroup = styled.div`
  margin-bottom: 16px;
`;

const Label = styled.label`
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: #86868b;
  margin-bottom: 6px;
`;

const Input = styled.input`
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #d1d1d1;
  border-radius: 6px;
  font-size: 13px;

  &:focus {
    outline: none;
    border-color: #007aff;
    box-shadow: 0 0 0 3px rgba(0, 122, 255, 0.1);
  }
`;

const Button = styled.button`
  padding: 8px 16px;
  background: #007aff;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;

  &:hover {
    background: #0051d5;
  }

  &:disabled {
    background: #c7c7cc;
    cursor: not-allowed;
  }
`;

const StatusMessage = styled.div<{ type: 'success' | 'error' | 'info' }>`
  padding: 12px;
  border-radius: 6px;
  margin-bottom: 16px;
  font-size: 13px;

  background: ${props => {
    switch(props.type) {
      case 'success': return '#d4f4dd';
      case 'error': return '#ffebe9';
      case 'info': return '#e3f2ff';
      default: return '#f5f5f7';
    }
  }};

  color: ${props => {
    switch(props.type) {
      case 'success': return '#00875a';
      case 'error': return '#de350b';
      case 'info': return '#0052cc';
      default: return '#1d1d1f';
    }
  }};
`;


const ProfileEditorContainer = styled.div`
  .mdxeditor {
    min-height: 150px;
    max-height: 200px;
    border: 1px solid #d1d1d1;
    border-radius: 6px;
    font-size: 13px;
  }

  .mdxeditor-toolbar {
    border-bottom: 1px solid #e5e5e7;
    background: #fafafa;
    padding: 6px;
  }

  .mdxeditor-root-contenteditable {
    padding: 12px;
    overflow-y: auto;
    max-height: 150px;
    position: relative;
  }

  /* Lexical-style placeholder positioning */
  .mdxeditor .editor-placeholder {
    color: #999;
    overflow: hidden;
    position: absolute;
    text-overflow: ellipsis;
    top: 0;
    left: 12px;
    font-size: 13px;
    user-select: none;
    display: inline-block;
    pointer-events: none;
  }

  /* Ensure first paragraph has no extra margin that could push placeholder down */
  .mdxeditor-root-contenteditable > p:first-child {
    margin-top: 0 !important;
    padding-top: 0 !important;
  }
`;

interface ProfileProps {}

function Profile({}: ProfileProps) {
  const [profile, setProfile] = useState<UserProfile>({
    name: '',
    company: '',
    title: '',
    aboutMe: '',
    preferences: ''
  });
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error' | 'info', text: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const aboutMeRef = useRef<any>(null);
  const preferencesRef = useRef<any>(null);

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    try {
      const loadedProfile = await window.electronAPI.getProfile();
      if (loadedProfile) {
        setProfile(loadedProfile);
      }
    } catch (error) {
      console.error('Failed to load profile:', error);
    }
  };

  const handleSaveProfile = async () => {
    setIsSaving(true);
    try {
      await window.electronAPI.updateProfile(profile);
      setStatusMessage({ type: 'success', text: 'Profile saved successfully' });
      setTimeout(() => setStatusMessage(null), 3000);
    } catch (error) {
      setStatusMessage({ type: 'error', text: 'Failed to save profile' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <ProfileContainer>
      {statusMessage && (
        <StatusMessage type={statusMessage.type}>
          {statusMessage.text}
        </StatusMessage>
      )}

      <Section>
        <SectionTitle>Profile Information</SectionTitle>
        <div style={{ fontSize: '13px', color: '#86868b', marginBottom: '16px' }}>
          Add your personal details and preferences for better meeting context
        </div>

        <FormGroup>
          <Label>Name</Label>
          <Input
            value={profile.name}
            onChange={(e) => setProfile({ ...profile, name: e.target.value })}
            placeholder="Your full name"
          />
        </FormGroup>

        <FormGroup>
          <Label>Company</Label>
          <Input
            value={profile.company}
            onChange={(e) => setProfile({ ...profile, company: e.target.value })}
            placeholder="Your company or organization"
          />
        </FormGroup>

        <FormGroup>
          <Label>Title</Label>
          <Input
            value={profile.title}
            onChange={(e) => setProfile({ ...profile, title: e.target.value })}
            placeholder="Your job title or role"
          />
        </FormGroup>

        <FormGroup>
          <Label>About Me</Label>
          <ProfileEditorContainer>
            <MDXEditor
              ref={aboutMeRef}
              markdown={profile.aboutMe}
              onChange={(value) => setProfile({ ...profile, aboutMe: value })}
              placeholder="Tell us about yourself, your role, and your expertise..."
              plugins={[
                headingsPlugin(),
                listsPlugin(),
                markdownShortcutPlugin(),
                toolbarPlugin({
                  toolbarContents: () => (
                    <>
                      <BoldItalicUnderlineToggles />
                      <ListsToggle />
                    </>
                  )
                })
              ]}
            />
          </ProfileEditorContainer>
        </FormGroup>

        <FormGroup>
          <Label>Meeting Preferences</Label>
          <ProfileEditorContainer>
            <MDXEditor
              ref={preferencesRef}
              markdown={profile.preferences}
              onChange={(value) => setProfile({ ...profile, preferences: value })}
              placeholder="How do you prefer meetings to be run? Any specific requirements or preferences?"
              plugins={[
                headingsPlugin(),
                listsPlugin(),
                markdownShortcutPlugin(),
                toolbarPlugin({
                  toolbarContents: () => (
                    <>
                      <BoldItalicUnderlineToggles />
                      <ListsToggle />
                    </>
                  )
                })
              ]}
            />
          </ProfileEditorContainer>
        </FormGroup>

        <Button onClick={handleSaveProfile} disabled={isSaving}>
          {isSaving ? 'Saving...' : 'Save Profile'}
        </Button>
      </Section>
    </ProfileContainer>
  );
}

export default Profile;