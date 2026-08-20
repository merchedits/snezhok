import { api } from "../../infrastructure/http/apiClient";
import { productApi } from "../../infrastructure/http/productApiClient";
import { createPeopleUseCases } from "./peopleUseCasesCore";

export { createPeopleUseCases, type PeopleGateway } from "./peopleUseCasesCore";

export const peopleUseCases = createPeopleUseCases({
  searchUsers: (query) => api.searchUsers(query),
  createConversation: (participantIds, title) => api.createConversation(participantIds, title),
  createGroup: (participantIds, title) => productApi.createGroup(participantIds, title),
  requestFriend: (username) => api.requestFriend(username),
  respondFriend: (requestId, action) => api.respondFriend(requestId, action),
  cancelFriendRequest: (requestId) => api.cancelFriendRequest(requestId),
  removeFriend: (userId) => api.removeFriend(userId),
  blockUser: (userId) => api.blockUser(userId),
  unblockUser: (userId) => productApi.unblockUser(userId),
});
