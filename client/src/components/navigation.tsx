import { Link, useLocation } from "wouter";
import { Sparkles, Menu, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

export function Navigation() {
  const [location] = useLocation();

  const navItems = [
    { href: "#wardrobe", label: "My Wardrobe" },
    { href: "#outfits", label: "Outfits" },
    { href: "#recommendations", label: "AI Suggestions" },
  ];

  return (
    <nav className="bg-white shadow-sm border-b border-gray-100 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <Link href="/" className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-gradient-to-br from-pink-500 to-indigo-500 rounded-lg flex items-center justify-center">
              <Sparkles className="text-white w-4 h-4" />
            </div>
            <h1 className="text-xl font-bold text-gray-900 font-serif">StyleSync</h1>
          </Link>

          <div className="hidden md:flex items-center space-x-6">
            {navItems.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="text-gray-700 hover:text-indigo-500 transition-colors"
              >
                {item.label}
              </a>
            ))}
            <Link href="/profile">
              <Button variant="outline" size="sm" className="flex items-center gap-2">
                <User className="w-4 h-4" />
                Profile
              </Button>
            </Link>
          </div>

          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden">
                <Menu className="w-5 h-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right">
              <div className="flex flex-col space-y-4 mt-8">
                {navItems.map((item) => (
                  <a
                    key={item.href}
                    href={item.href}
                    className="text-gray-700 hover:text-indigo-500 transition-colors text-lg"
                  >
                    {item.label}
                  </a>
                ))}
                <Link href="/profile" className="text-gray-700 hover:text-indigo-500 transition-colors text-lg flex items-center gap-2">
                  <User className="w-5 h-5" />
                  Profile
                </Link>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </nav>
  );
}