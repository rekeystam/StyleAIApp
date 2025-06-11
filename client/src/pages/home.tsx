import { Navigation } from "@/components/navigation";
import { UploadZone } from "@/components/upload-zone";
import { WardrobeGallery } from "@/components/wardrobe-gallery";
import { OutfitSuggestions } from "@/components/outfit-suggestions";
import { AIAnalysisPanel } from "@/components/ai-analysis-panel";
import { Button } from "@/components/ui/button";
import { Eye, UserCheck, Sparkles, Plus } from "lucide-react";

export default function Home() {
  const scrollToUpload = () => {
    document.getElementById('upload')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      
      {/* Hero Section */}
      <section className="bg-gradient-to-br from-pink-100 via-white to-pink-200 py-16 lg:py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="text-center lg:text-left">
              <h1 className="text-4xl lg:text-6xl font-bold text-gray-900 font-serif mb-6">
                Optimize Your{" "}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-pink-500 to-indigo-500">
                  Wardrobe
                </span>{" "}
                with AI
              </h1>
              <p className="text-xl text-gray-600 mb-8 leading-relaxed">
                Upload your clothes, get personalized style recommendations, and create perfect outfits tailored to your body type using Google Gemini AI.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
                <Button
                  onClick={scrollToUpload}
                  className="bg-indigo-500 hover:bg-indigo-600 text-white px-8 py-3 text-lg transform hover:scale-105 transition-all shadow-lg"
                >
                  Start Building Your Wardrobe
                </Button>
                <Button
                  variant="outline"
                  className="border-2 border-gray-300 hover:border-indigo-500 text-gray-700 hover:text-indigo-500 px-8 py-3 text-lg transition-all"
                >
                  See How It Works
                </Button>
              </div>
            </div>
            <div className="relative">
              <img
                src="https://images.unsplash.com/photo-1445205170230-053b83016050?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&h=600"
                alt="Fashion clothing items flat lay"
                className="rounded-2xl shadow-2xl w-full"
              />
              <div className="absolute -bottom-4 -right-4 bg-white p-4 rounded-xl shadow-lg">
                <div className="flex items-center space-x-2">
                  <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
                  <span className="text-sm font-medium text-gray-700">AI Analyzing...</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <UploadZone />
      
      {/* AI Analysis Section */}
      <section className="py-16 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl lg:text-4xl font-bold text-gray-900 font-serif mb-4">
              AI Analysis & Tagging
            </h2>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              Automatically analyze and categorize your clothing items using advanced AI technology.
            </p>
          </div>
          <AIAnalysisPanel />
        </div>
      </section>
      
      <WardrobeGallery />
      <OutfitSuggestions />

      {/* Features Section */}
      <section className="py-16 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl lg:text-4xl font-bold text-gray-900 font-serif mb-4">
              Powered by Google Gemini AI
            </h2>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              Advanced artificial intelligence analyzes your clothing items and creates personalized recommendations just for you.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="w-16 h-16 bg-gradient-to-br from-indigo-500 to-pink-500 rounded-2xl mx-auto mb-4 flex items-center justify-center">
                <Eye className="text-white w-8 h-8" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">Smart Analysis</h3>
              <p className="text-gray-600">
                AI recognizes colors, patterns, fabric types, and style categories automatically.
              </p>
            </div>

            <div className="text-center">
              <div className="w-16 h-16 bg-gradient-to-br from-pink-500 to-green-500 rounded-2xl mx-auto mb-4 flex items-center justify-center">
                <UserCheck className="text-white w-8 h-8" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">Body Type Matching</h3>
              <p className="text-gray-600">
                Personalized suggestions based on your unique body type and preferences.
              </p>
            </div>

            <div className="text-center">
              <div className="w-16 h-16 bg-gradient-to-br from-green-500 to-indigo-500 rounded-2xl mx-auto mb-4 flex items-center justify-center">
                <Sparkles className="text-white w-8 h-8" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">Style Evolution</h3>
              <p className="text-gray-600">
                Learns from your choices to improve recommendations over time.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-16 bg-gradient-to-br from-indigo-500 to-pink-500">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl lg:text-4xl font-bold text-white font-serif mb-4">
            Ready to Transform Your Style?
          </h2>
          <p className="text-xl text-white/90 mb-8">
            Join thousands of users who've already optimized their wardrobes with AI-powered recommendations.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button
              onClick={scrollToUpload}
              className="bg-white hover:bg-gray-100 text-indigo-600 px-8 py-3 text-lg transform hover:scale-105 transition-all shadow-lg"
            >
              Start Your Free Trial
            </Button>
            <Button
              variant="outline"
              className="border-2 border-white text-white hover:bg-white hover:text-indigo-600 px-8 py-3 text-lg transition-all"
            >
              Watch Demo
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-gray-300 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-4 gap-8">
            <div>
              <div className="flex items-center space-x-3 mb-4">
                <div className="w-8 h-8 bg-gradient-to-br from-pink-500 to-indigo-500 rounded-lg flex items-center justify-center">
                  <Sparkles className="text-white w-4 h-4" />
                </div>
                <h3 className="text-xl font-bold text-white font-serif">StyleSync</h3>
              </div>
              <p className="text-gray-400">
                AI-powered wardrobe optimization for the modern fashion enthusiast.
              </p>
            </div>
            
            <div>
              <h4 className="text-white font-semibold mb-4">Product</h4>
              <ul className="space-y-2">
                <li><a href="#" className="hover:text-white transition-colors">Features</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Pricing</a></li>
                <li><a href="#" className="hover:text-white transition-colors">API</a></li>
              </ul>
            </div>
            
            <div>
              <h4 className="text-white font-semibold mb-4">Company</h4>
              <ul className="space-y-2">
                <li><a href="#" className="hover:text-white transition-colors">About</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Blog</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Careers</a></li>
              </ul>
            </div>
            
            <div>
              <h4 className="text-white font-semibold mb-4">Support</h4>
              <ul className="space-y-2">
                <li><a href="#" className="hover:text-white transition-colors">Help Center</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Contact</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Privacy</a></li>
              </ul>
            </div>
          </div>
          
          <div className="border-t border-gray-800 pt-8 mt-8 text-center">
            <p className="text-gray-400">
              &copy; 2024 StyleSync. All rights reserved. Powered by Google Gemini AI.
            </p>
          </div>
        </div>
      </footer>

      {/* Floating Upload Button (Mobile) */}
      <Button
        onClick={scrollToUpload}
        className="fixed bottom-6 right-6 bg-gradient-to-br from-pink-500 to-indigo-500 hover:from-pink-600 hover:to-indigo-600 text-white w-14 h-14 rounded-full shadow-lg hover:shadow-xl transition-all transform hover:scale-110 md:hidden"
      >
        <Plus className="w-6 h-6" />
      </Button>
    </div>
  );
}
