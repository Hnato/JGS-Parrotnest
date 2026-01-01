using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.Authorization;
using ParrotnestServer.Data;
using ParrotnestServer.Models;
using ParrotnestServer.Services;
using Microsoft.EntityFrameworkCore;
using System.Threading.Tasks;
using System.Linq;
using System;
using System.Security.Claims;

namespace ParrotnestServer.Hubs
{
    [Authorize]
    public class ChatHub : Hub
    {
        private readonly ApplicationDbContext _context;
        private readonly IUserTracker _userTracker;

        public ChatHub(ApplicationDbContext context, IUserTracker userTracker)
        {
            _context = context;
            _userTracker = userTracker;
        }

        private int? GetUserId()
        {
            var claim = Context.User?.FindFirst(ClaimTypes.NameIdentifier);
            if (claim != null && int.TryParse(claim.Value, out int userId))
            {
                return userId;
            }
            return null;
        }

        public override async Task OnConnectedAsync()
        {
            var userId = GetUserId();
            if (userId.HasValue)
            {
                await _userTracker.UserConnected(Context.ConnectionId, userId.Value);
                await Clients.All.SendAsync("UserStatusChanged", userId.Value, true);
            }
            await base.OnConnectedAsync();
        }

        public override async Task OnDisconnectedAsync(Exception? exception)
        {
            var userId = GetUserId();
            await _userTracker.UserDisconnected(Context.ConnectionId);
            
            if (userId.HasValue)
            {
                 bool isOnline = await _userTracker.IsUserOnline(userId.Value);
                 if (!isOnline)
                 {
                     await Clients.All.SendAsync("UserStatusChanged", userId.Value, false);
                 }
            }
            await base.OnDisconnectedAsync(exception);
        }

        public async Task SendMessage(string user, string message, string? imageUrl = null, int? receiverId = null, int? groupId = null)
        {
            Console.WriteLine($"[ChatHub] SendMessage called by {Context.User?.Identity?.Name}. Msg: {message}, Img: {imageUrl}, Rec: {receiverId}, Grp: {groupId}");
            try 
            {
                // Find sender
                var senderUsername = Context.User?.Identity?.Name;
                var sender = await _context.Users.FirstOrDefaultAsync(u => u.Username == senderUsername);

                if (sender != null)
                {
                    Console.WriteLine($"[ChatHub] Sender found: {sender.Id} ({sender.Username})");
                    // Create message object
                    var msg = new Message
                    {
                        Content = message ?? string.Empty,
                        ImageUrl = imageUrl,
                        SenderId = sender.Id,
                        ReceiverId = receiverId, // null for global/group, userId for private
                        GroupId = groupId,
                        Timestamp = DateTime.UtcNow
                    };

                    // Save to database
                    Console.WriteLine("[ChatHub] Saving message to DB...");
                    _context.Messages.Add(msg);
                    await _context.SaveChangesAsync();
                    Console.WriteLine($"[ChatHub] Message saved. ID: {msg.Id}");

                    if (groupId.HasValue)
                    {
                        // Group message - send to all members
                        var members = await _context.GroupMembers
                            .Where(gm => gm.GroupId == groupId.Value)
                            .Select(gm => gm.UserId)
                            .ToListAsync();

                        foreach (var memberId in members)
                        {
                            await Clients.User(memberId.ToString()).SendAsync("ReceiveMessage", sender.Id, senderUsername, message ?? string.Empty, imageUrl, receiverId, groupId);
                        }
                    }
                    else if (receiverId.HasValue)
                    {
                        // Private message - send to both users
                        var receiver = await _context.Users.FindAsync(receiverId.Value);
                        if (receiver != null)
                        {
                            await Clients.User(sender.Id.ToString()).SendAsync("ReceiveMessage", sender.Id, senderUsername, message ?? string.Empty, imageUrl, receiverId, null);
                            await Clients.User(receiverId.Value.ToString()).SendAsync("ReceiveMessage", sender.Id, senderUsername, message ?? string.Empty, imageUrl, receiverId, null);
                        }
                    }
                    else
                    {
                        // Global chat - broadcast to all
                        await Clients.All.SendAsync("ReceiveMessage", sender.Id, senderUsername, message ?? string.Empty, imageUrl, null, null);
                    }
                }
                else
                {
                    Console.WriteLine($"[ChatHub] Sender NOT found for username: {senderUsername}");
                    await Clients.Caller.SendAsync("ReceiveMessage", 0, "System", "Błąd: Nie znaleziono użytkownika. Zaloguj się ponownie.", null, null, null);
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error sending message: {ex.Message}");
                Console.WriteLine(ex.StackTrace);
                await Clients.Caller.SendAsync("ReceiveMessage", 0, "System", $"Błąd wysyłania wiadomości: {ex.Message}", null, null, null);
            }
        }
        
        public async Task JoinGroup(string groupName)
        {
            await Groups.AddToGroupAsync(Context.ConnectionId, groupName);
            await Clients.Group(groupName).SendAsync("ReceiveMessage", "System", $"{Context.User?.Identity?.Name} joined {groupName}");
        }
    }
}
