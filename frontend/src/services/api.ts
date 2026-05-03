import axios from 'axios';

const API_BASE_URL = 'http://localhost:3030/api';

export const wikiApi = {
  getPages: async () => {
    const response = await axios.get(`${API_BASE_URL}/pages`);
    return response.data.pages;
  },
  getPage: async (filename: string) => {
    const response = await axios.get(`${API_BASE_URL}/pages/${filename}`);
    return response.data;
  },
  savePage: async (title: string, content: string) => {
    const response = await axios.post(`${API_BASE_URL}/pages`, { title, content });
    return response.data;
  },
  getRawFiles: async () => {
    const response = await axios.get(`${API_BASE_URL}/raw`);
    return response.data.files;
  },
  chat: async (message: string, history: any[] = []) => {
    const response = await axios.post(`${API_BASE_URL}/chat`, { message, history });
    return response.data;
  }
};
