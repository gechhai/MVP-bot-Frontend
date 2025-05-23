import React, { useState, useCallback, useEffect, useRef } from 'react';
import MessageList from './message';
import ChatInput from './chatinput';
import ResponseSelector from './responseselector';
import { useRouter, useSearchParams } from 'next/navigation';
import { useChatContext } from '../layout';
import FileBox from './filebox';

interface ResponseOption {
  fileName: string;
  content: string;
  publishDate: string;
  fileId: string;
}

interface ChatWindowProps {
  initialMessage: string;
  onNewChat?: () => void;
}

const ChatWindow: React.FC<ChatWindowProps> = ({ initialMessage, onNewChat }) => {
  const [messages, setMessages] = useState<{ text: React.ReactNode; sender: 'user' | 'bot' }[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentGroupId, setCurrentGroupId] = useState('');
  const [multipleResponses, setMultipleResponses] = useState<ResponseOption[] | null>(null);
  const [isWaitingForSelection, setIsWaitingForSelection] = useState(false);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const hasSentInitialMessage = useRef(false);
  const lastFetchedGroupId = useRef<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const groupId = searchParams.get('groupId');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { setHasMessages } = useChatContext();

  // Update context when messages change
  useEffect(() => {
    setHasMessages(messages.length > 0);
  }, [messages, setHasMessages]);

  // Format bot response
  const formatBotResponse = useCallback((responseText: string, fileId?: string, fileName?: string, publishDate?: string) => (
    <div key={fileId || responseText} className="mb-0">
      <div className="whitespace-pre-line mb-4">
        {responseText
          .split('\n')
          .filter((line) => line.trim() !== '')
          .map((line, lineIndex) => (
            <div key={lineIndex} className="flex items-start">
              <span className="mr-2">•</span>
              <span>{line.replace(/^\*/g, '').trim()}</span>
            </div>
          ))}
      </div>
      {fileId && fileName && publishDate && (
        <FileBox fileId={fileId} fileName={fileName} publishDate={publishDate} />
      )}
    </div>
  ), []);

  // Fetch chat history
  const fetchChatHistory = useCallback(async (groupId: string) => {
    if (lastFetchedGroupId.current === groupId) return;

    setIsLoading(true);
    try {
      const accessToken = localStorage.getItem('accessToken');
      if (!accessToken) throw new Error('User is not authenticated');

      const response = await fetch(`http://127.0.0.1:8000/chat/history/?group_id=${groupId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) throw new Error('Network response was not ok');

      const data = await response.json();
      if (!data.data || data.data.length === 0) {
        router.push('/chatbot', { scroll: false });
        setCurrentGroupId('');
        lastFetchedGroupId.current = null;

        const localSessions = JSON.parse(localStorage.getItem('chatSessions') || '[]');
        const updatedSessions = localSessions.filter((session: any) => session.group_id !== groupId);
        localStorage.setItem('chatSessions', JSON.stringify(updatedSessions));
        window.dispatchEvent(new Event('chatSessionUpdate'));
        return;
      }

      const formattedMessages = data.data.flatMap((chat: any) => [
        { text: chat.question, sender: 'user' },
        { text: chat.answer.map((item: [string, string, string, string]) => formatBotResponse(item[1], item[3], item[0], item[2])), sender: 'bot' },
      ]);

      setMessages(formattedMessages);
      lastFetchedGroupId.current = groupId;
    } catch (error) {
      console.error('Error fetching chat history:', error);
      setMessages([{ text: "Failed to load chat history. Please try again.", sender: 'bot' }]);
    } finally {
      setIsLoading(false);
    }
  }, [formatBotResponse, router]);

  // Get chatbot response
  const getChatbotResponse = useCallback(async (query: string) => {
    if (!query.trim() || isLoading || isWaitingForSelection) return;

    setIsLoading(true);
    try {
      const accessToken = localStorage.getItem('accessToken');
      if (!accessToken) throw new Error('User is not authenticated');

      const response = await fetch('http://127.0.0.1:8000/chat/ask/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ question: query, groupId: currentGroupId || "" }),
      });

      if (!response.ok) throw new Error('Network response was not ok');

      const data = await response.json();
      if (data.group_id && !currentGroupId) {
        router.push(`/chatbot?groupId=${data.group_id}`, { scroll: false });

        if (query.trim() !== "") {
          const firstQuestionHistory = JSON.parse(localStorage.getItem('chatSessions') || '[]');
          const newSession = { group_id: data.group_id, first_question: query };

          if (!firstQuestionHistory.some((session: any) => session.group_id === data.group_id)) {
            localStorage.setItem('chatSessions', JSON.stringify([...firstQuestionHistory, newSession]));
            window.dispatchEvent(new Event('chatSessionUpdate'));
          }
        }
      }

      setCurrentGroupId(data.group_id);
      lastFetchedGroupId.current = data.group_id;

      // Handle multiple responses
      if (data.response && data.response.length > 1) {
        const options = data.response.map((item: [string, string, string, string]) => ({
          fileName: item[0],
          content: item[1],
          publishDate: item[2],
          fileId: item[3],
        }));
        setMultipleResponses(options);
        setIsWaitingForSelection(true);
        setCurrentChatId(data.chat_id); // Capture the chat ID
      } else if (data.response && data.response.length === 1) {
        const botResponse = data.response.map((item: [string, string, string, string]) =>
          formatBotResponse(item[1], item[3], item[0], item[2])
        );
        setMessages((prev) => [...prev, { text: botResponse, sender: 'bot' }]);
      } else {
        setMessages((prev) => [...prev, { text: "I couldn't find any relevant information for your query.", sender: 'bot' }]);
      }
    } catch (error) {
      console.error('Error fetching chatbot response:', error);
      setMessages((prev) => [...prev, { text: "Sorry, I couldn't fetch the response. Please try again.", sender: 'bot' }]);
    } finally {
      setIsLoading(false);
    }
  }, [currentGroupId, formatBotResponse, router, isLoading, isWaitingForSelection]);

  // Handle sending messages
  const handleSend = useCallback((query: string) => {
    if (!query.trim() || isLoading || isWaitingForSelection) return;
    setMessages((prev) => [...prev, { text: query, sender: 'user' }]);
    setMultipleResponses(null);
    getChatbotResponse(query);
  }, [getChatbotResponse, isLoading, isWaitingForSelection]);

  // Handle response selection
  const handleResponseSelection = useCallback(async (selectedOption: ResponseOption, selectedIndex: number) => {
    if (!currentChatId) return;

    try {
      const accessToken = localStorage.getItem('accessToken');
      if (!accessToken) throw new Error('User is not authenticated');

      const response = await fetch('http://127.0.0.1:8000/chat/best-answer/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ chat_id: currentChatId, chat_index: selectedIndex }),
      });

      if (!response.ok) throw new Error('Network response was not ok');

      const botResponse = formatBotResponse(
        selectedOption.content,
        selectedOption.fileId,
        selectedOption.fileName,
        selectedOption.publishDate
      );
      setMessages((prev) => [...prev, { text: botResponse, sender: 'bot' }]);
      setMultipleResponses(null);
      setIsWaitingForSelection(false);
    } catch (error) {
      console.error('Error selecting best answer:', error);
    }
  }, [currentChatId, formatBotResponse]);

  // Handle groupId changes
  useEffect(() => {
    if (groupId) {
      if (groupId !== lastFetchedGroupId.current) {
        setCurrentGroupId(groupId);
        fetchChatHistory(groupId);
        hasSentInitialMessage.current = true;
      }
    } else if (lastFetchedGroupId.current !== null) {
      setMessages([]);
      setCurrentGroupId('');
      hasSentInitialMessage.current = false;
      lastFetchedGroupId.current = null;
      setHasMessages(false);
      onNewChat?.();
    }
  }, [groupId, fetchChatHistory, onNewChat, setHasMessages]);

  // Handle initial message
  useEffect(() => {
    if (initialMessage.trim() && !hasSentInitialMessage.current && !groupId) {
      hasSentInitialMessage.current = true;
      setMessages([{ text: initialMessage, sender: 'user' }]);
      getChatbotResponse(initialMessage);
    }
  }, [initialMessage, groupId, getChatbotResponse]);

  // Scroll to bottom when messages change or when multipleResponses changes
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, multipleResponses]);

  return (
    <div className="flex flex-col h-screen">
      <div className="flex-1 pb-20 over-flow-auto">
        <div className="flex flex-col space-y-4 p-4">
          <MessageList messages={messages} isLoading={isLoading && !multipleResponses} />

          {/* Display response selection UI when multiple responses are available */}
          {multipleResponses && (
            <ResponseSelector
              options={multipleResponses}
              onSelectResponse={async (option, index) => await handleResponseSelection(option, index)}
            />
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>
      <div className="fixed bottom-0 left-0 w-full bg-transparent border-t border-gray-200 p-2">
        <div className="w-full max-w-xl mx-auto">
          <ChatInput
            onUserMessage={handleSend}
            isDisabled={isLoading || isWaitingForSelection}
          />
        </div>
      </div>
    </div>
  );
};

export default ChatWindow;