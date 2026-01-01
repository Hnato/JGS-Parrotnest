using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.AspNetCore.StaticFiles;
using System.Text;
using ParrotnestServer.Data;
using ParrotnestServer.Hubs;
using ParrotnestServer.Services;

var builder = WebApplication.CreateBuilder(args);


builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddSignalR();
builder.Services.AddSingleton<IUserTracker, UserTracker>();


var connectionString = builder.Configuration.GetConnectionString("DefaultConnection");
builder.Services.AddDbContext<ApplicationDbContext>(options =>
    options.UseSqlite(connectionString));


var jwtKey = builder.Configuration["Jwt:Key"] ?? "SuperSecretKeyForParrotnestApplication123!";
builder.Services.AddAuthentication(options =>
{
    options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
    options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
})
.AddJwtBearer(options =>
{
    options.TokenValidationParameters = new TokenValidationParameters
    {
        ValidateIssuer = false,
        ValidateAudience = false,
        ValidateLifetime = true,
        ValidateIssuerSigningKey = true,
        IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey))
    };
    
    // Support SignalR Auth
    options.Events = new JwtBearerEvents
    {
        OnMessageReceived = context =>
        {
            var accessToken = context.Request.Query["access_token"];
            var path = context.HttpContext.Request.Path;
            if (!string.IsNullOrEmpty(accessToken) && path.StartsWithSegments("/chatHub"))
            {
                context.Token = accessToken;
            }
            return Task.CompletedTask;
        }
    };
});

// CORS
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowAll", builder =>
    {
        builder.AllowAnyOrigin() // In production, replace with specific client URL
               .AllowAnyMethod()
               .AllowAnyHeader();
    });
});

var app = builder.Build();

// Auto-migration on startup
using (var scope = app.Services.CreateScope())
{
    var dbContext = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
    dbContext.Database.EnsureCreated(); // Creates DB if not exists (simple approach)
    // dbContext.Database.Migrate(); // Use this if you have migrations enabled
}

// Configure the HTTP request pipeline.
    // Use "0.0.0.0" to listen on all network interfaces
    app.Urls.Add("http://0.0.0.0:5000");

    if (app.Environment.IsDevelopment())
    {
        app.UseSwagger();
        app.UseSwaggerUI();
    }

    // app.UseHttpsRedirection(); // HTTPS disabled for compatibility
    app.UseCors("AllowAll");

// Configure static files to be served from the Client directory
string GetClientPath(string startPath)
{
    var current = startPath;
    for (int i = 0; i < 8; i++)
    {
        var client = Path.Combine(current, "Client");
        if (Directory.Exists(client))
        {
            return Path.GetFullPath(client);
        }
        var parent = Directory.GetParent(current);
        if (parent == null) break;
        current = parent.FullName;
    }
    // Fallback to default logic if not found (e.g. create parallel to ContentRoot)
    return Path.GetFullPath(Path.Combine(startPath, "..", "Client"));
}

var clientPath = GetClientPath(builder.Environment.ContentRootPath);
builder.Configuration["ClientPath"] = clientPath; // Store for Controllers

if (Directory.Exists(clientPath))
    {
        var fileProvider = new Microsoft.Extensions.FileProviders.PhysicalFileProvider(clientPath);

        // Set login.php as the default page
        var defaultFilesOptions = new DefaultFilesOptions
        {
            FileProvider = fileProvider
        };
        defaultFilesOptions.DefaultFileNames.Clear();
        defaultFilesOptions.DefaultFileNames.Add("login.php");
        defaultFilesOptions.DefaultFileNames.Add("index.php");
        app.UseDefaultFiles(defaultFilesOptions);

        var provider = new FileExtensionContentTypeProvider();
        provider.Mappings[".php"] = "text/html";

        app.UseStaticFiles(new StaticFileOptions
        {
            FileProvider = fileProvider,
            ContentTypeProvider = provider
        });
    }
else
{
    Console.WriteLine($"Warning: Client directory not found at {clientPath}");
    app.UseStaticFiles(); // Fallback to wwwroot
}

app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();
app.MapHub<ChatHub>("/chatHub");

// Ensure Database Created
using (var scope = app.Services.CreateScope())
{
    var dbContext = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
    dbContext.Database.EnsureCreated();
}

app.Run();
