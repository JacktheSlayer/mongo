import axios from "axios";

const API_URL = "http://localhost:5000/api";

export const getNearestMember = async (groupCode, lat, lng, token) => {
  try {
    const res = await axios.get(`${API_URL}/group/${groupCode}/nearest`, {
      params: { lat, lng },
      headers: { Authorization: `Bearer ${token}` }
    });
    return res.data;
  } catch (err) {
    console.error("Error fetching nearest member:", err);
    return null;
  }
};
