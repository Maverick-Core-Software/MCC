import axios from 'axios';

const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
const openaiApiKey = process.env.OPENAI_API_KEY;

export const fetchAnthropicUsage = async () => {
  // Replace with actual API call to fetch usage
  try {
    return await axios.get('https://api.anthropic.com/usage', {
      headers: { 'Authorization': `Bearer ${anthropicApiKey}` }
    });
  } catch (error) {
    console.error('Error fetching Anthropic usage:', error);
    throw error;
  }
};

export const fetchOpenAIUsage = async () => {
  // Replace with actual API call to fetch usage
  try {
    return await axios.get('https://api.openai.com/v1/usage', {
      headers: { 'Authorization': `Bearer ${openaiApiKey}` }
    });
  } catch (error) {
    console.error('Error fetching OpenAI usage:', error);
    throw error;
  }
};