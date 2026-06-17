'use client';

import { useEffect, useState } from 'react';
import { fetchAnthropicUsage, fetchOpenAIUsage } from '../src/lib/api';

const HomePage = () => {
  const [anthropicUsage, setAnthropicUsage] = useState({ sessionUsage: 0, weeklyUsage: 0 });
  const [openAIUsage, setOpenAIUsage] = useState({ sessionUsage: 0, weeklyUsage: 0 });

  useEffect(() => {
    const fetchData = async () => {
      try {
        const anthropicResponse = await fetchAnthropicUsage();
        const openAIResponse = await fetchOpenAIUsage();

        setAnthropicUsage(anthropicResponse.data);
        setOpenAIUsage(openAIResponse.data);
      } catch (error) {
        console.error('Error fetching usage data:', error);
      }
    };

    fetchData();
  }, []);

  return (
    <div>
      <h1>API Usage Monitor</h1>
      <div>
        <h2>Anthropic Usage</h2>
        <div><h3>Session Usage: {anthropicUsage.sessionUsage}</h3><h3>Weekly Usage: {anthropicUsage.weeklyUsage}</h3></div>
      </div>
      <div>
        <h2>OpenAI Usage</h2>
        <div><h3>Session Usage: {openAIUsage.sessionUsage}</h3><h3>Weekly Usage: {openAIUsage.weeklyUsage}</h3></div>
      </div>
    </div>
  );
};

export default HomePage;
