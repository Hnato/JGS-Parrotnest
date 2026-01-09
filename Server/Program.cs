using System;
using System.Windows.Forms;
namespace ParrotnestServer
{
    internal static class Program
    {
        [STAThread]
        static void Main()
        {
            ApplicationConfiguration.Initialize();
            Application.Run(new ServerControlForm());
        }
    }
}
